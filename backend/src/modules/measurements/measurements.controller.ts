import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../../common/types/authenticated-user";
import { LatestMeasurementQueryDto } from "./dto/latest-measurement-query.dto";
import { ListMeasurementsQueryDto } from "./dto/list-measurements-query.dto";
import { SeriesQueryDto } from "./dto/series-query.dto";
import { MeasurementsService } from "./measurements.service";

@ApiTags("Measurements")
@ApiBearerAuth()
@Controller("measurements")
export class MeasurementsController {
  constructor(private readonly measurementsService: MeasurementsService) {}

  @Get("latest")
  @ApiOperation({ summary: "Get the latest measurement" })
  async latest(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LatestMeasurementQueryDto,
  ) {
    return { data: await this.measurementsService.latest(user.id, query) };
  }

  @Get("series")
  @ApiOperation({ summary: "Get bucketed measurements for charts" })
  async series(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SeriesQueryDto,
  ) {
    return { data: await this.measurementsService.series(user.id, query) };
  }

  @Get()
  @ApiOperation({ summary: "List measurement history" })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMeasurementsQueryDto,
  ) {
    const result = await this.measurementsService.list(user.id, query);
    return { data: result.items, meta: result.meta };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get measurement detail" })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return { data: await this.measurementsService.get(user.id, id) };
  }
}
