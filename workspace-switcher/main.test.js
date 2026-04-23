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

test("syncDailyState updates stale journal paths only", async () => {
  const { WorkspaceSwitcherPlugin } = loadWorkspaceSwitcherPlugin();
  const { app, changedLayouts } = createApp({
    main: {
      type: "leaf",
      state: {
        state: {
          file: "journal/2026-04-23.md",
        },
      },
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
    changedLayouts[0].main.state.state.file,
    "journal/2026-04-24.md"
  );
});

test("loadSavedWorkspaceByName only updates journal paths", async () => {
  const { WorkspaceSwitcherPlugin, notices } = loadWorkspaceSwitcherPlugin();
  const { app, changedLayouts } = createApp({});
  const plugin = new WorkspaceSwitcherPlugin(app);
  plugin.data = {
    workspaces: {
      Focus: {
        main: {
          type: "leaf",
          state: {
            state: {
              file: "journal/2026-04-23.md",
            },
          },
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

  assert.deepEqual(ensureCalls, ["journal/2026-04-24.md"]);
  assert.equal(changedLayouts.length, 1);
  assert.equal(
    changedLayouts[0].main.state.state.file,
    "journal/2026-04-24.md"
  );
  assert.deepEqual(notices, ['Workspace "Focus" loaded.']);
});
