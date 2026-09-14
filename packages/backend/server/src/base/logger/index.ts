import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../config';
import { NotesGraphLogger } from './service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [NotesGraphLogger],
  exports: [NotesGraphLogger],
})
export class LoggerModule {}

export { NotesGraphLogger } from './service';
