import {
  Controller,
  Get,
  Post,
  Delete,
  Inject,
  Req,
  Body,
  Param,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Auth } from './auth';
import { ApiKeys } from './api-keys';
@Controller('api/v1')
export class ApiKeysController {
  constructor(
    @Inject(Auth) private auth: Auth,
    @Inject(ApiKeys) private keys: ApiKeys,
  ) {}
  private async session(req: Request, admin = false) {
    if (req.headers.authorization)
      throw new ForbiddenException('Use a dashboard session to manage API keys');
    return this.auth.require(req, admin);
  }
  @Get('api-keys/options') async options(@Req() req: Request) {
    return { data: this.keys.options(await this.session(req)) };
  }
  @Get('api-keys') async list(@Req() req: Request) {
    return { data: await this.keys.list(await this.session(req)) };
  }
  @Post('api-keys') async create(@Req() req: Request, @Body() body: unknown) {
    return { data: await this.keys.create(await this.session(req), body) };
  }
  @Post('api-keys/:id/rotate') async rotate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { data: await this.keys.rotate(await this.session(req), id, body) };
  }
  @Delete('api-keys/:id') async revoke(@Req() req: Request, @Param('id') id: string) {
    return { data: await this.keys.revoke(await this.session(req), id) };
  }
  @Get('admin/api-keys') async all(@Req() req: Request, @Query() query: unknown) {
    await this.session(req, true);
    return { data: await this.keys.all(query) };
  }
  @Post('admin/api-keys/:id/revoke') async staffRevoke(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { data: await this.keys.revoke(await this.session(req, true), id, true, body) };
  }
}
