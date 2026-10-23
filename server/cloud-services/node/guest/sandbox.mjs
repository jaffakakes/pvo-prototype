/** Immutable host policy. Generated source never supplies OCI flags, mounts or process credentials. */
export const sandboxFlags = Object.freeze([
  "--root=/control/state",
  "--network=none",
  "--platform=systrap",
  "--directfs=false",
  "--host-uds=none",
  "--host-fifo=none",
  "--ignore-cgroups=true",
  "--overlay2=none",
]);

export const sandboxSpec = Object.freeze({
  ociVersion: "1.0.2",
  root: { path: "/sandbox/rootfs", readonly: true },
  process: {
    terminal: false,
    user: { uid: 1000, gid: 1000 },
    args: ["/usr/local/bin/node", "/runtime/server.mjs"],
    env: ["PATH=/usr/local/bin", "HOME=/tmp"],
    cwd: "/service",
    noNewPrivileges: true,
    capabilities: {
      bounding: [],
      effective: [],
      inheritable: [],
      permitted: [],
      ambient: [],
    },
    rlimits: [
      { type: "RLIMIT_NOFILE", hard: 256, soft: 256 },
      { type: "RLIMIT_NPROC", hard: 64, soft: 64 },
      { type: "RLIMIT_CORE", hard: 0, soft: 0 },
    ],
  },
  mounts: [
    { destination: "/proc", type: "proc", source: "proc" },
    { destination: "/dev", type: "tmpfs", source: "tmpfs" },
    {
      destination: "/tmp",
      type: "tmpfs",
      source: "tmpfs",
      options: ["nosuid", "nodev", "noexec", "mode=1777", "size=16777216"],
    },
    {
      destination: "/service",
      type: "tmpfs",
      source: "tmpfs",
      options: [
        "nosuid",
        "nodev",
        "noexec",
        "mode=0700",
        "uid=1000",
        "gid=1000",
        "size=4194304",
      ],
    },
  ],
  linux: {
    namespaces: ["pid", "network", "ipc", "uts", "mount"].map((type) => ({
      type,
    })),
  },
});
