import { Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { EVENTS } from "../../common/events";
import { AppException } from "../../common/errors/app.exception";
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from "../../common/types/authenticated-user";
import { DevicesService } from "../devices/devices.service";
import { DeviceStatusEvent } from "../devices/devices.service";

interface MeasurementEvent {
  userId: string;
  deviceId: string;
  deviceCode: string;
  measurement: Record<string, unknown>;
}

interface AlertEvent {
  userId: string;
  alert: Record<string, unknown>;
}

@WebSocketGateway({
  namespace: "/realtime",
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly devicesService: DevicesService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<AccessTokenPayload>(token);
      if (!payload.sub || !payload.email) {
        throw new Error("Malformed token");
      }
      const user: AuthenticatedUser = {
        id: payload.sub,
        email: payload.email,
        role: payload.role ?? "USER",
      };
      client.data.user = user;
      await client.join(userRoom(user.id));
      this.logger.debug(`Socket ${client.id} connected for user ${user.id}`);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("device:subscribe")
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { deviceId?: string },
  ) {
    const user = client.data.user as AuthenticatedUser | undefined;
    if (!user) {
      throw new WsException("Unauthorized");
    }
    if (!body?.deviceId) {
      throw new WsException("deviceId is required");
    }

    try {
      await this.devicesService.assertAccess(user.id, body.deviceId);
    } catch (error) {
      if (error instanceof AppException) {
        throw new WsException(error.code);
      }
      throw error;
    }

    await client.join(deviceRoom(body.deviceId));
    return { ok: true, deviceId: body.deviceId };
  }

  @SubscribeMessage("device:unsubscribe")
  async unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { deviceId?: string },
  ) {
    if (!body?.deviceId) {
      throw new WsException("deviceId is required");
    }
    await client.leave(deviceRoom(body.deviceId));
    return { ok: true, deviceId: body.deviceId };
  }

  @OnEvent(EVENTS.MEASUREMENT_CREATED)
  onMeasurementCreated(event: MeasurementEvent): void {
    if (!this.server) {
      return;
    }
    const payload = {
      ...event.measurement,
      deviceCode: event.deviceCode,
    };
    this.server
      .to(deviceRoom(event.deviceId))
      .emit("measurement:update", payload);
  }

  @OnEvent(EVENTS.DEVICE_STATUS_CHANGED)
  onDeviceStatusChanged(event: DeviceStatusEvent): void {
    if (!this.server) {
      return;
    }
    this.server.to(userRoom(event.userId)).emit("device:status", {
      deviceId: event.deviceId,
      deviceCode: event.deviceCode,
      status: event.status,
      lastSeenAt: event.lastSeenAt,
    });
  }

  @OnEvent(EVENTS.ALERT_CREATED)
  onAlertCreated(event: AlertEvent): void {
    if (!this.server) {
      return;
    }
    this.server.to(userRoom(event.userId)).emit("alert:new", event.alert);
  }
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function deviceRoom(deviceId: string): string {
  return `device:${deviceId}`;
}

function extractToken(client: Socket): string | undefined {
  const auth = client.handshake.auth as Record<string, unknown> | undefined;
  if (auth && typeof auth.token === "string") {
    return auth.token;
  }
  const header = client.handshake.headers.authorization;
  if (typeof header === "string") {
    const [scheme, value] = header.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value) {
      return value;
    }
  }
  return undefined;
}
