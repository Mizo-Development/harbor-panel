import { GameFilesController, GameFilesGuard } from './game-files';
import { GameEggs } from './game-eggs';
import { GameEggsController } from './game-eggs-controller';
import { Invoicing } from './invoicing';
import { InvoiceDocuments } from './invoice-documents';
import { SettingsAdmin } from './settings-admin';
import { SystemMonitor } from './system-monitor';
import { Carts } from './cart';
import { ApiKeys } from './api-keys';
import { ApiKeysController } from './api-keys-controller';
import { NodeInstallations, NodeSetupController } from './node-installations';
import { Offers } from './offers';
import { Cancellations } from './cancellations';
import { Taxes } from './taxes';
import { Catalog } from './catalog';
import { Module } from '@nestjs/common';
import { Db } from './db';
import { Auth } from './auth';
import { Mailer } from './mailer';
import { Extensions } from './extensions';
import { Payments } from './payments';
import { Platform } from './platform';
import { Consoles } from './console';
import { Jobs } from './jobs';
import { Wallets } from './wallet';
import { Tickets } from './tickets';
import { Coupons } from './coupons';
import { ApiController, WebhookController } from './controller';
import { RemoteController } from './remote';
@Module({
  controllers: [
    ApiController,
    GameEggsController,
    GameFilesController,
    WebhookController,
    RemoteController,
    NodeSetupController,
    ApiKeysController,
  ],
  providers: [
    Db,
    GameEggs,
    GameFilesGuard,
    Mailer,
    Auth,
    Extensions,
    Payments,
    Platform,
    Jobs,
    Consoles,
    Wallets,
    Tickets,
    Coupons,
    Catalog,
    Taxes,
    Cancellations,
    Offers,
    Invoicing,
    InvoiceDocuments,
    SettingsAdmin,
    SystemMonitor,
    Carts,
    ApiKeys,
    NodeInstallations,
  ],
})
export class AppModule {}
