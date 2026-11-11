import { Controller, Get, Post, Patch, Body, Inject, Req, Param } from '@nestjs/common';
import type { Request } from 'express';
import { Auth } from './auth';
import { GameEggs } from './game-eggs';
@Controller('api/v1/admin/eggs')
export class GameEggsController {
  constructor(
    @Inject(Auth) private auth: Auth,
    @Inject(GameEggs) private eggs: GameEggs,
  ) {}
  @Get() async list(@Req() req: Request) {
    await this.auth.require(req, true);
    return { data: await this.eggs.list() };
  }
  @Post() async create(@Req() req: Request, @Body() body: unknown) {
    return { data: await this.eggs.save(await this.auth.require(req, true), body) };
  }
  @Patch(':id') async update(@Req() req: Request, @Body() body: unknown, @Param('id') id: string) {
    return { data: await this.eggs.save(await this.auth.require(req, true), body, id) };
  }
}
