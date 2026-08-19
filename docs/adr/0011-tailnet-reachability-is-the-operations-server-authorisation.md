# Tailnet reachability is the Operations server's authorisation

The Operations server binds the mini's tailnet address and nothing else, and asks arriving
requests for no credential at all. Every device on the Tailnet is the Owner's, so opening the
socket is already the proof a token would be asked to supply — and a request that has not crossed
the Tailnet never reaches a listening socket to be refused.

A bearer token on top was rejected for what it would cost rather than for what it would add: the
token is a credential file on every consuming machine, which is the boundary ADR-0008 drew for
Google's credentials being redrawn in the same place for the same reason. The second-machine
checklist is two items — Tailscale signed in, one user-scoped MCP registration — and a token
makes it three, the third being the one that must be rotated, synced and kept out of a module
folder. Binding every interface and filtering by source address was rejected as the same
protection written in a place where a mistake is silent: an unbound interface serves the house
network until someone reads the filter.

stdio over SSH was rejected at the transport decision for putting SSH keys on every consuming
machine and narrowing which clients can connect. Streamable HTTP over the Tailnet keeps the
surface to one URL that any MCP-speaking agent registers.

## Consequences

The mini must be on the Tailnet for the server to start: there is no address to bind that would
serve anyone else, so a machine signed out of Tailscale fails at startup rather than quietly
listening on the house network.

An arriving request is trusted with the full interactive-write Tasks credential, so anything that
can reach the socket can write to the Owner's task lists. The Tailnet is therefore the security
boundary in fact and not only in intent: a machine joined to it is a machine trusted with the
Owner's tasks, and joining is the decision that matters.

The one caller a tailnet address does not exclude is a browser on a machine already joined,
reaching the server from a page the Owner did not write. The server refuses any request carrying
an `Origin` header, since no browser is a client of this surface.

Consuming machines carry no credential, no clone and no Node install, so a machine leaves the
system by being removed from the Tailnet.

## Revisit when

The Tailnet stops being all the Owner's devices — a shared machine, a device lent out, or an
agent runtime that is not the Owner's — or a served operation reaches something the Tailnet is
not a sufficient boundary for.
