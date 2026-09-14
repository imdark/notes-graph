import { Module } from '@nestjs/common';

import { DocStorageModule } from '../doc';
import { PermissionModule } from '../permission';
import { NotesApiController } from './controller';

@Module({
  imports: [DocStorageModule, PermissionModule],
  controllers: [NotesApiController],
})
export class NotesApiModule {}
