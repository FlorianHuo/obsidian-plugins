const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadWorkspaceSwitcherPlugin() {
  const pluginPath = require.resolve("./main.js");
  delete require.cache[pluginPath];

  const notices = [];
  const obsidianMock = {
    Plugin: class {
      constructor(app) {
        this.app = app;
      }

      async loadData() {
        return {};
      }

      async saveData(data) {
        this.savedData = data;
      }

      registerInterval() {}

      registerDomEvent() {}

      addCommand() {}

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

test("loadSavedWorkspaceByName applies configured rewrites and rolls journal paths", async () => {
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
  assert.deepEqual(notices, ['Workspace "Focus" loaded.']);
});
