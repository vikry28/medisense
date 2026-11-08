import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../../common/types/authenticated-user";
import { DevicesService } from "./devices.service";
import { PairDeviceDto } from "./dto/pair-device.dto";
import { UpdateDeviceDto } from "./dto/update-device.dto";

@ApiTags("Devices")
@ApiBearerAuth()
@Controller("devices")
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @ApiOperation({ summary: "List devices paired to the current user" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.devicesService.list(user.id) };
  }

  @Post("pair")
  @ApiOperation({ summary: "Pair a device using its 6-digit pairing code" })
  async pair(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PairDeviceDto,
  ) {
    return { data: await this.devicesService.pair(user.id, dto) };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get device details and online status" })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return { data: await this.devicesService.get(user.id, id) };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Rename a paired device" })
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDeviceDto,
  ) {
    return { data: await this.devicesService.rename(user.id, id, dto) };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Unpair a device (history is preserved)" })
  async unpair(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.devicesService.unpair(user.id, id);
  }

  @Post(":id/pairing-code")
  @ApiOperation({ summary: "Generate a new pairing code for a paired device" })
  async regenerateCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return {
      data: await this.devicesService.regeneratePairingCode(user.id, id),
    };
  }
}
