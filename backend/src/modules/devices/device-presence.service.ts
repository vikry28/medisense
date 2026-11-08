import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DevicesService } from "./devices.service";

@Injectable()
export class DevicePresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DevicePresenceService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly devicesService: DevicesService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      "DEVICE_SWEEPER_INTERVAL_MS",
      30_000,
    );
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async sweep(): Promise<void> {
    const threshold = this.config.get<number>(
      "DEVICE_OFFLINE_THRESHOLD_SECONDS",
      90,
    );
    try {
      const count = await this.devicesService.sweepOffline(threshold);
      if (count > 0) {
        this.logger.log(`Marked ${count} stale device(s) as offline`);
      }
    } catch (error) {
      this.logger.error({ err: error }, "Device presence sweep failed");
    }
  }
}
