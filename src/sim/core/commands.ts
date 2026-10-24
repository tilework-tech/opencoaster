/**
 * Player/debug inputs. Commands are applied at the start of a tick, in arrival order, so
 * replaying (seed, [(tick, command)...]) reproduces a game exactly.
 */
export type Command =
  | { type: 'spawnGuests'; count: number }
  | { type: 'spawnStaff'; count: number; kind: number }
  | { type: 'setTileHeight'; x: number; y: number; height: number };

export interface TimedCommand {
  tick: number;
  command: Command;
}
