import { Module } from '@nestjs/common';

import { UppyRelayController } from './controller';

@Module({
  controllers: [UppyRelayController],
})
export class UppyRelayModule {}
