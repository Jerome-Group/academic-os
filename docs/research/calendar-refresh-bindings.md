# What must a Calendar refresh token and cancellation retain?

Checked 2026-10-25 for [#393](https://github.com/Jerome-Group/academic-os/issues/393).

Google's sync guide defines incremental results as changes since the previous sync. It requires
consistent query parameters and a new full sync after HTTP 410. An unchanged event newly included
by an earlier horizon cannot be recovered from an old delta. Therefore a token must remain bound
to its calendar identity, initial horizon and supported query shape. This binding is our inference
from the [sync contract](https://developers.google.com/workspace/calendar/api/guides/sync).

The Events list reference prohibits `timeMin` alongside `syncToken`; the initial full request
supplies the horizon, while incremental requests omit that filter. `singleEvents: false` retains
masters and exceptions, and `showDeleted: true` includes cancellations. A changed or undocumented
query requires a full rebuild. Absence across different query scopes cannot establish deletion.
See [Events list parameters](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

Google guarantees only an ID for an ordinary deleted event. A cancelled recurring exception also
has its master identity and original start; descriptions, geometry and organizer may be absent.
Thus a full recovery response cannot replace same-calendar last-known content or invited access
with a sparse cancellation. Details from another calendar cannot supply that history. See the
[event status contract](https://developers.google.com/workspace/calendar/api/v3/reference/events#resource).

These conclusions justify a rebuilt live collection plus separately retained recovery evidence.
Isolated provider-backed CLI checks prove local requests, mirror/proposal bytes and recovery
snapshots. They do not establish real-account Calendar parity.
