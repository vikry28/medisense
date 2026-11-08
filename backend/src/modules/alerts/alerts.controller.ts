import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../../common/types/authenticated-user";
import { AlertsService } from "./alerts.service";
import { ListAlertsQueryDto } from "./dto/list-alerts-query.dto";
import { UpdateAlertConfigsDto } from "./dto/update-alert-configs.dto";

@ApiTags("Alerts")
@ApiBearerAuth()
@Controller("alerts")
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: "List alerts for the current user" })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAlertsQueryDto,
  ) {
    const result = await this.alertsService.list(user.id, query);
    return { data: result.items, meta: result.meta };
  }

  @Get("config")
  @ApiOperation({ summary: "Get alert thresholds" })
  async getConfig(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.alertsService.getConfigs(user.id) };
  }

  @Put("config")
  @ApiOperation({ summary: "Update alert thresholds" })
  async updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAlertConfigsDto,
  ) {
    return {
      data: await this.alertsService.updateConfigs(user.id, dto.configs),
    };
  }

  @Patch("read-all")
  @ApiOperation({ summary: "Mark all alerts as read" })
  async readAll(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.alertsService.markAllRead(user.id) };
  }

  @Patch(":id/read")
  @ApiOperation({ summary: "Mark one alert as read" })
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return { data: await this.alertsService.markRead(user.id, id) };
  }
}
