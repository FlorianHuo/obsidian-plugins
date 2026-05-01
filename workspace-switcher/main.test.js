const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadWorkspaceSwitcherPlugin(options = {}) {
  const pluginPath = require.resolve("./main.js");
  delete require.cache[pluginPath];

  const notices = [];
  const commands = [];
  const obsidianMock = {
    Plugin: class {
      constructor(app, manifest) {
        this.app = app;
        this.manifest = manifest;
      }

      async loadData() {
        if (!this.manifest || !this.manifest.dir) {
          throw new TypeError("Cannot read properties of undefined (reading 'dir')");
        }
        return options.loadData || {};
      }

      async saveData(data) {
        this.savedData = data;
      }

      registerInterval() {}

      registerDomEvent() {}

      addCommand(command) {
        commands.push(command);
      }

      addSettingTab() {}
    },
    PluginSettingTab: class {
      constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
      }
    },
    FuzzySuggestModal: class {
      constructor(app) {
        this.app = app;
      }

      setPlaceholder() {}
    },
    Modal: class {
      constructor(app) {
        this.app = app;
        this.contentEl = {
          empty() {},
          createEl() {
            return {
              style: {},
              focus() {},
              addEventListener() {},
            };
          },
          createDiv() {
            return {
              createEl() {
                return {
                  addEventListener() {},
                };
              },
            };
          },
        };
      }
    },
    Notice: class {
      constructor(message) {
        notices.push(message);
      }
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "obsidian") {
      return obsidianMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return {
      WorkspaceSwitcherPlugin: require("./main.js"),
      commands,
      notices,
    };
  } finally {
    Module._load = originalLoad;
  }
}

function createApp(layout) {
  const changedLayouts = [];

  return {
    app: {
      workspace: {
        getLayout() {
          return JSON.parse(JSON.stringify(layout));
        },
        async changeLayout(nextLayout) {
          changedLayouts.push(JSON.parse(JSON.stringify(nextLayout)));
        },
      },
      vault: {},
    },
    changedLayouts,
  };
}

function createLeafLayout(file) {
  return {
    main: {
      type: "split",
      children: [
        {
          type: "leaf",
          state: {
            state: {
              file,
            },
          },
        },
      ],
    },
  };
}

function createManifest() {
  return {
    dir: "/mock-vault/.obsidian/plugins/workspace-switcher",
    id: "workspace-switcher",
  };
}

test("onload keeps recent switching and picker as separate commands", async () => {
  const { WorkspaceSwitcherPlugin, commands } = loadWorkspaceSwitcherPlugin();
  const originalWindow = global.window;
  global.window = {
    setInterval() {
      return 1;
    },
  };

  try {
    const plugin = new WorkspaceSwitcherPlugin(
      {
        workspace: {
          onLayoutReady() {},
        },
        vault: {},
      },
      createManifest()
    );
    await plugin.onload();
  } finally {
    global.window = originalWindow;
  }

  const recentCommand = commands.find((command) =>
    command.id === "quick-switch-workspace"
  );
  const pickerCommand = commands.find((command) =>
    command.id === "open-workspace-picker"
  );

  assert.equal(recentCommand.name, "Switch to recent workspace");
  assert.deepEqual(recentCommand.hotkeys, [
    {
      modifiers: ["Alt"],
      key: "W",
    },
  ]);
  assert.equal(pickerCommand.name, "Quick switch workspace");
  assert.equal(pickerCommand.hotkeys, undefined);
});

test("onload infers daily note folder from legacy saved workspaces", async () => {
  const { WorkspaceSwitcherPlugin } = loadWorkspaceSwitcherPlugin({
    loadData: {
      workspaces: {
        main: createLeafLayout("02-journal/2026-04-22.md"),
        work: createLeafLayout("01-tracks/current.md"),
        shop: createLeafLayout("02-journal/2026-04-24.md"),
      },
    },
  });
  const originalWindow = global.window;
  global.window = {
    setInterval() {
      return 1;
    },
  };

  try {
    const plugin = new WorkspaceSwitcherPlugin(
      {
        workspace: {
          onLayoutReady() {},
        },
        vault: {},
      },
      createManifest()
    );
    await plugin.onload();

    assert.equal(plugin.settings.dailyNoteFolder, "02-journal");
    assert.equal(plugin.data.settings.dailyNoteFolder, "02-journal");
  } finally {
    global.window = originalWindow;
  }
});

test("onload prefers the core daily notes folder over saved-layout inference", async () => {
  const { WorkspaceSwitcherPlugin } = loadWorkspaceSwitcherPlugin({
    loadData: {
      workspaces: {
        old: createLeafLayout("journal/2026-04-22.md"),
      },
    },
  });
  const originalWindow = global.window;
  global.window = {
    setInterval() {
      return 1;
    },
  };

  try {
    const plugin = new WorkspaceSwitcherPlugin(
      {
        workspace: {
          onLayoutReady() {},
        },
        vault: {
          adapter: {
            async read(path) {
              assert.equal(path, ".obsidian/daily-notes.json");
              return JSON.stringify({ folder: "02-journal" });
            },
          },
        },
      },
      createManifest()
    );
    await plugin.onload();

    assert.equal(plugin.settings.dailyNoteFolder, "02-journal");
  } finally {
    global.window = originalWindow;
  }
});

test("ensureFile creates missing parent folders before the note", async () => {
  const { WorkspaceSwitcherPlugin } = loadWorkspaceSwitcherPlugin();
  const existingPaths = new Set();
  const createdFolders = [];
  const createdFiles = [];
  const plugin = new WorkspaceSwitcherPlugin({
    vault: {
      getAbstractFileByPath(path) {
        return existingPaths.has(path) ? { path } : null;
      },
      async createFolder(path) {
        createdFolders.push(path);
        existingPaths.add(path);
        return { path };
      },
      async create(path) {
        createdFiles.push(path);
        existingPaths.add(path);
        return { path };
      },
    },
  });

  await plugin.ensureFile("02-journal/archive/2026-04-28.md");

  assert.deepEqual(createdFolders, ["02-journal", "02-journal/archive"]);
  assert.deepEqual(createdFiles, ["02-journal/archive/2026-04-28.md"]);
});

test("syncDailyState defaults to generic journal paths without local rewrites", async () => {
  const { WorkspaceSwitcherPlugin } = loadWorkspaceSwitcherPlugin();
  const { app, changedLayouts } = createApp({
    main: {
      type: "split",
      children: [
        {
          type: "leaf",
          state: {
            state: {
              file: "journal/2026-04-23.md",
            },
          },
        },
        {
          type: "leaf",
          state: {
            state: {
              file: "tracks/current.md",
            },
          },
        },
      ],
    },
  });

  const plugin = new WorkspaceSwitcherPlugin(app);
  plugin.data = {};
  plugin.getTodayDateStr = () => "2026-04-24";

  const ensureCalls = [];
  plugin.ensureFile = async (path) => {
    ensureCalls.push(path);
  };

  await plugin.syncDailyState();

  assert.deepEqual(ensureCalls, ["journal/2026-04-24.md"]);
  assert.equal(changedLayouts.length, 1);
  assert.equal(
    changedLayouts[0].main.children[0].state.state.file,
    "journal/2026-04-24.md"
  );
  assert.equal(
    changedLayouts[0].main.children[1].state.state.file,
    "tracks/current.md"
  );
});

test("syncDailyState applies configured local rewrites before daily rollover", async () => {
  const { WorkspaceSwitcherPlugin } = loadWorkspaceSwitcherPlugin();
  const { app, changedLayouts } = createApp({
    main: {
      type: "split",
      children: [
        {
          type: "leaf",
          state: {
            state: {
              file: "journal/2026-04-23.md",
            },
          },
        },
        {
          type: "leaf",
          state: {
            state: {
              file: "tracks/current.md",
            },
          },
        },
      ],
    },
  });

  const plugin = new WorkspaceSwitcherPlugin(app);
  plugin.data = {};
  plugin.settings = {
    dailyNoteFolder: "Daily",
    pathRewriteRules: "prefix: journal/ -> Daily/\nprefix: tracks/ -> Projects/",
  };
  plugin.getTodayDateStr = () => "2026-04-24";

  const ensureCalls = [];
  plugin.ensureFile = async (path) => {
    ensureCalls.push(path);
  };

  await plugin.syncDailyState();

  assert.deepEqual(ensureCalls, ["Daily/2026-04-24.md"]);
  assert.equal(changedLayouts.length, 1);
  assert.equal(
    changedLayouts[0].main.children[0].state.state.file,
    "Daily/2026-04-24.md"
  );
  assert.equal(
    changedLayouts[0].main.children[1].state.state.file,
    "Projects/current.md"
  );
});

test("loadSavedWorkspaceByName applies configured rewrites and loads silently", async () => {
  const { WorkspaceSwitcherPlugin, notices } = loadWorkspaceSwitcherPlugin();
  const { app, changedLayouts } = createApp({});
  const plugin = new WorkspaceSwitcherPlugin(app);
  plugin.settings = {
    dailyNoteFolder: "Daily",
    pathRewriteRules: "prefix: journal/ -> Daily/\nprefix: tracks/ -> Projects/\nexact: legacy/shop.md -> Shop.md",
  };
  plugin.data = {
    workspaces: {
      Focus: {
        main: {
          type: "split",
          children: [
            {
              type: "leaf",
              state: {
                state: {
                  file: "journal/2026-04-23.md",
                },
              },
            },
            {
              type: "leaf",
              state: {
                state: {
                  file: "legacy/shop.md",
                },
              },
            },
            {
              type: "leaf",
              state: {
                state: {
                  file: "tracks/current.md",
                },
              },
            },
          ],
        },
      },
    },
  };
  plugin.getTodayDateStr = () => "2026-04-24";

  const ensureCalls = [];
  plugin.ensureFile = async (path) => {
    ensureCalls.push(path);
  };

  await plugin.loadSavedWorkspaceByName("Focus");

  assert.deepEqual(ensureCalls, ["Daily/2026-04-24.md"]);
  assert.equal(changedLayouts.length, 1);
  assert.equal(
    changedLayouts[0].main.children[0].state.state.file,
    "Daily/2026-04-24.md"
  );
  assert.equal(
    changedLayouts[0].main.children[1].state.state.file,
    "Shop.md"
  );
  assert.equal(
    changedLayouts[0].main.children[2].state.state.file,
    "Projects/current.md"
  );
  assert.deepEqual(notices, []);
});

test("toggleRecentWorkspace loads the previous recent workspace and flips history", async () => {
  const { WorkspaceSwitcherPlugin, notices } = loadWorkspaceSwitcherPlugin();
  const { app, changedLayouts } = createApp({});
  const plugin = new WorkspaceSwitcherPlugin(app);
  plugin.data = {
    workspaces: {
      Focus: createLeafLayout("focus.md"),
      Planning: createLeafLayout("planning.md"),
    },
    recentWorkspaceNames: ["Focus", "Planning"],
  };
  plugin.getTodayDateStr = () => "2026-04-24";
  plugin.ensureFile = async () => {};

  await plugin.toggleRecentWorkspace();

  assert.equal(changedLayouts.length, 1);
  assert.equal(
    changedLayouts[0].main.children[0].state.state.file,
    "planning.md"
  );
  assert.deepEqual(plugin.data.recentWorkspaceNames, ["Planning", "Focus"]);
  assert.deepEqual(plugin.savedData.recentWorkspaceNames, ["Planning", "Focus"]);
  assert.deepEqual(notices, []);
});

test("toggleRecentWorkspace opens picker while recent history is incomplete", async () => {
  const { WorkspaceSwitcherPlugin, notices } = loadWorkspaceSwitcherPlugin();
  const { app, changedLayouts } = createApp({});
  const plugin = new WorkspaceSwitcherPlugin(app);
  plugin.data = {
    workspaces: {
      Focus: createLeafLayout("focus.md"),
      Planning: createLeafLayout("planning.md"),
    },
    recentWorkspaceNames: ["Focus"],
  };
  let openedPicker = false;
  plugin.openWorkspaceQuickSwitch = () => {
    openedPicker = true;
  };

  await plugin.toggleRecentWorkspace();

  assert.equal(changedLayouts.length, 0);
  assert.equal(openedPicker, true);
  assert.deepEqual(notices, [
    "Choose a second workspace to enable recent switching.",
  ]);
});
