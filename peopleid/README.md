# peopleid

One identity for the whole suite: the app name the host derives accounts from,
the mask that holds the identity, and the handle that names it.

This is a package rather than a pattern because every app here had its own copy
of who is this person, and the copies drifted silently. One asked the host for an
account under its own product name and got a different address than its
neighbour; another cached a resolved handle under a key that never invalidated.
Same user, three answers, no error anywhere.

Named after peoplebook deliberately. It was called `dotid` for an afternoon,
which was careless: DotID is somebody else project and this has nothing to do
with it. The name and the thing now agree.

See `src/index.ts`. Not published to npm; apps in this workspace import it
directly.
