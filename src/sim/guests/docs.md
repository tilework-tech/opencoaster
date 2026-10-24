# sim/guests

Responsibility: guest (and litter) data and behaviour: needs, mood, ride choice, wandering, queueing, spending.

Interface: `GUEST_SCHEMA` columns, `spawnGuest(world)`, `guestSystem`, `LITTER_SCHEMA`, `litterSystem`. Current `guestSystem` is a random-walk placeholder that exists so the performance path is exercised. Real behaviour must stay allocation-free and O(1) amortised per guest per tick (spread expensive decisions over multiple ticks keyed by entity id).
