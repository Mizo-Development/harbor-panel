import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { z } from 'zod';
import { Db, json } from './db';
import { serial } from './transactions';
import type { Actor } from './auth';
import {
  PAPER_EGG_ID,
  builtinPaper,
  eggDigest,
  parseEgg,
  gameConfigSchema,
  eggEnvironment,
  paperInstall,
  resolvePaper,
} from './game-egg-definition';
export * from './game-egg-definition';
@Injectable()
export class GameEggs implements OnModuleInit {
  constructor(@Inject(Db) private db: Db) {}
  async onModuleInit() {
    const definition = builtinPaper();
    await this.db.gameEgg.upsert({
      where: { id: PAPER_EGG_ID },
      update: {},
      create: {
        id: PAPER_EGG_ID,
        name: definition.name,
        nest: 'Minecraft',
        definition: json(definition),
        digest: eggDigest(definition),
      },
    });
  }
  async list() {
    return this.db.gameEgg.findMany({ orderBy: [{ nest: 'asc' }, { name: 'asc' }] });
  }
  async save(actor: Actor, input: unknown, id?: string) {
    const d = z
      .object({
        nest: z.string().trim().min(1).max(100),
        definition: z.unknown(),
        reviewedScript: z.literal(true),
        archived: z.boolean().default(false),
      })
      .strict()
      .parse(input);
    if (id === PAPER_EGG_ID)
      throw new ConflictException(
        'The automatic Paper egg is managed by Harbor. Import a copy to customize it.',
      );
    const definition = parseEgg(d.definition);
    const data = {
      nest: d.nest,
      name: definition.name,
      definition: json(definition),
      digest: eggDigest(definition),
      archived: d.archived,
    };
    return this.db.$transaction(async (tx) => {
      const egg = id
        ? await tx.gameEgg.update({ where: { id }, data })
        : await tx.gameEgg.create({ data });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'game.egg.saved',
          targetId: egg.id,
          details: json({ digest: egg.digest }),
        },
      });
      return egg;
    });
  }
  async assignment(input: unknown, db: any = this.db) {
    const config = gameConfigSchema.parse(input || {});
    const row = await db.gameEgg.findUnique({ where: { id: config.eggId || PAPER_EGG_ID } });
    if (!row || row.archived) throw new BadRequestException('Select an available game egg');
    const egg = parseEgg(row.definition);
    const environment = eggEnvironment(egg, config.variables);
    const selectedImage = config.image || Object.values(egg.docker_images)[0];
    if (!Object.values(egg.docker_images).includes(selectedImage))
      throw new BadRequestException('Choose an image provided by the selected egg');
    return {
      eggId: row.id,
      name: row.name,
      digest: row.digest,
      definition: egg,
      image: selectedImage,
      environment,
    };
  }
  async startup(service: any, actor: Actor) {
    const assignment =
      service.metadata.gameAssignment || (await this.assignment(service.product.gameConfig));
    const egg = parseEgg(assignment.definition);
    return {
      name: assignment.name,
      image: assignment.image,
      digest: assignment.digest,
      variables: egg.variables
        .filter((v) => actor.role === 'ADMIN' || v.user_viewable)
        .map((v) => ({
          ...v,
          value: assignment.environment[v.env_variable] ?? v.default_value,
          editable: actor.role === 'ADMIN' || v.user_editable,
        })),
      currentRelease: service.metadata.gameRuntime?.release
        ? {
            version: service.metadata.gameRuntime.release.version,
            build: service.metadata.gameRuntime.release.build,
          }
        : null,
    };
  }
  async saveStartup(serviceId: string, actor: Actor, input: unknown) {
    const d = z
      .object({ variables: z.record(z.string(), z.string().max(2048)) })
      .strict()
      .parse(input);
    return serial(this.db, async (tx) => {
      const service = await tx.service.findFirst({
        where: { id: serviceId, ...(actor.role === 'ADMIN' ? {} : { userId: actor.id }) },
        include: { product: true },
      });
      if (!service || service.provider !== 'wings')
        throw new NotFoundException('Game server not found');
      if (
        ['TERMINATED', 'INSTALLING', 'PROVISIONING'].includes(service.status) ||
        (service.status === 'SUSPENDED' && actor.role !== 'ADMIN') ||
        (await tx.operation.count({ where: { serviceId, status: { in: ['PENDING', 'RUNNING'] } } }))
      )
        throw new ConflictException(
          'Wait until the server is available and all operations finish before changing startup variables',
        );
      const metadata = service.metadata as any;
      const assignment =
        metadata.gameAssignment || (await this.assignment(service.product.gameConfig, tx));
      const egg = parseEgg(assignment.definition);
      for (const key of Object.keys(d.variables)) {
        const v = egg.variables.find((v) => v.env_variable === key);
        if (!v || (actor.role !== 'ADMIN' && (!v.user_editable || !v.user_viewable)))
          throw new BadRequestException(`Variable ${key} cannot be edited`);
      }
      const environment = eggEnvironment(egg, { ...assignment.environment, ...d.variables });
      await tx.service.update({
        where: { id: serviceId },
        data: { metadata: json({ ...metadata, gameAssignment: { ...assignment, environment } }) },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'service.egg.variables.updated',
          targetId: serviceId,
          details: { variables: Object.keys(d.variables) },
        },
      });
      return { message: 'Startup variables saved. Reinstall to apply them.' };
    });
  }
  async prepare(service: any, operationId: string, connection: any) {
    const metadata = service.metadata as Record<string, any>;
    if (metadata.gameRuntime?.operationId === operationId) return metadata;
    const assignment =
      metadata.gameAssignment || (await this.assignment(service.product.gameConfig));
    const egg = parseEgg(assignment.definition);
    let install = {
      container_image: egg.scripts.installation.container,
      entrypoint: egg.scripts.installation.entrypoint,
      script: egg.scripts.installation.script,
    };
    let release: any = null,
      runtimeImage = assignment.image;
    if (assignment.eggId === PAPER_EGG_ID) {
      if (connection.config.paperDownloadUrl || connection.config.paperSha256) {
        release = {
          version: 'Custom pinned release',
          build: 'custom',
          url: String(connection.config.paperDownloadUrl || ''),
          sha256: String(connection.config.paperSha256 || ''),
        };
      } else {
        release = await resolvePaper(
          assignment.environment.MINECRAFT_VERSION,
          assignment.environment.BUILD_NUMBER,
        );
        // Paper 1.20.5+ requires Java 21; 26.1+ requires Java 25. Older supported releases use 17.
        const [major, minor, patch = 0] = release.version.split('.').map(Number);
        const java =
          major >= 26
            ? 25
            : minor > 20 || (minor === 20 && patch >= 5)
              ? 21
              : minor >= 18
                ? 17
                : minor === 17
                  ? 16
                  : minor >= 13
                    ? 11
                    : 8;
        runtimeImage = `ghcr.io/ptero-eggs/yolks:java_${java}`;
      }
      install = paperInstall(release, assignment.environment.SERVER_JARFILE);
    }
    const gameRuntime = {
      ...assignment,
      image: runtimeImage,
      install,
      release,
      operationId,
      resolvedAt: new Date().toISOString(),
    };
    const updated = await this.db.service.update({
      where: { id: service.id },
      data: { metadata: json({ ...metadata, gameAssignment: assignment, gameRuntime }) },
    });
    return updated.metadata as Record<string, any>;
  }
}
