import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, mutations } = vi.hoisted(() => {
  const s = {
    selected: [],
    lastSelectedIndex: null,
    isSearchActive: false,
    prompt: null,
    view: "listingView",
    isCard: false,
    req: { path: "/", source: "data" },
  };
  return {
    store: s,
    mutations: {
      resetSelected: vi.fn(() => { s.selected = []; }),
      addSelected: vi.fn((idx) => { if (!s.selected.includes(idx)) s.selected.push(idx); }),
      removeSelected: vi.fn((idx) => { s.selected = s.selected.filter(i => i !== idx); }),
      setLastSelectedIndex: vi.fn((idx) => { s.lastSelectedIndex = idx; }),
      setMultiple: vi.fn(),
    },
  };
});

vi.mock("@/store", () => ({
  state: store,
  mutations,
  getters: {
    isShare: () => false,
    currentView: () => store.view,
    currentPromptName: () => store.prompt,
    isCardView: () => store.isCard,
    sourcePermissions: () => ({ modify: true, create: true }),
    globalPermissions: () => ({ modify: true, create: true }),
  },
}));

vi.mock("@/utils/download", () => ({ default: vi.fn() }));
vi.mock("@/api", () => ({ resourcesApi: {} }));
vi.mock("@/router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/utils/upload", () => ({ readAllDirectoryEntries: vi.fn(), checkConflict: vi.fn() }));
vi.mock("@/utils/throttle", () => ({ default: (fn) => fn }));
vi.mock("@/utils", () => ({ url: { removeLastDir: vi.fn(), buildItemUrl: vi.fn() } }));
vi.mock("@/components/files/ListingItem.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/prompts/Upload.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/LoadingSpinner.vue", () => ({ default: { render: () => null } }));
vi.mock("@/utils/listingTypeAhead.js", () => ({
  isTypeAheadSessionActive: () => false,
  processTypeAheadKey: vi.fn(),
  resetTypeAheadSession: vi.fn(),
}));
vi.mock("@/utils/appNotifications", () => ({ notifyMoveCopyFailure: vi.fn() }));

import ListingView from "./ListingView.vue";

const createMockContext = (items) => {
  return {
    allItems: items,
    leadIndex: null,
    dragTargets: new Set(),
    permissions: { modify: true },
    selectedCount: store.selected.length,
    $el: {
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
    },
    ...ListingView.methods,
  };
};

describe("ListingView keyboard navigation and continuous multi-selection", () => {
  const mockItems = [
    { index: 0, name: "folder1", type: "directory" },
    { index: 1, name: "folder2", type: "directory" },
    { index: 2, name: "file1.txt", type: "text/plain" },
    { index: 3, name: "file2.jpg", type: "image/jpeg" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    store.selected = [];
    store.lastSelectedIndex = null;
    store.isSearchActive = false;
    store.prompt = null;
    store.view = "listingView";
    store.isCard = false;
  });

  it("selects first item on ArrowDown when nothing was selected", () => {
    const ctx = createMockContext(mockItems);
    ctx.keyEvent({ key: "ArrowDown", preventDefault: vi.fn() });

    expect(mutations.resetSelected).toHaveBeenCalled();
    expect(mutations.addSelected).toHaveBeenCalledWith(0);
    expect(ctx.leadIndex).toBe(0);
  });

  it("moves single selection on normal ArrowDown and ArrowUp", () => {
    const ctx = createMockContext(mockItems);
    store.selected = [0];
    store.lastSelectedIndex = 0;
    ctx.leadIndex = 0;

    ctx.keyEvent({ key: "ArrowDown", preventDefault: vi.fn() });
    expect(mutations.resetSelected).toHaveBeenCalled();
    expect(mutations.addSelected).toHaveBeenCalledWith(1);
    expect(mutations.setLastSelectedIndex).toHaveBeenCalledWith(1);
    expect(ctx.leadIndex).toBe(1);

    ctx.keyEvent({ key: "ArrowUp", preventDefault: vi.fn() });
    expect(mutations.addSelected).toHaveBeenCalledWith(0);
    expect(ctx.leadIndex).toBe(0);
  });

  it("extends range selection on Shift + ArrowDown without changing anchor", () => {
    const ctx = createMockContext(mockItems);
    store.selected = [0];
    store.lastSelectedIndex = 0; // Anchor
    ctx.leadIndex = 0;

    // Shift + ArrowDown: selects [0, 1]
    ctx.keyEvent({ key: "ArrowDown", shiftKey: true, preventDefault: vi.fn() });
    expect(store.selected).toEqual([0, 1]);
    expect(store.lastSelectedIndex).toBe(0); // Anchor stays 0
    expect(ctx.leadIndex).toBe(1);
    expect(mutations.setMultiple).toHaveBeenCalledWith(true);

    // Another Shift + ArrowDown: selects [0, 1, 2]
    ctx.keyEvent({ key: "ArrowDown", shiftKey: true, preventDefault: vi.fn() });
    expect(store.selected).toEqual([0, 1, 2]);
    expect(store.lastSelectedIndex).toBe(0);
    expect(ctx.leadIndex).toBe(2);

    // Shift + ArrowUp: contracts selection back to [0, 1]
    ctx.keyEvent({ key: "ArrowUp", shiftKey: true, preventDefault: vi.fn() });
    expect(store.selected).toEqual([0, 1]);
    expect(store.lastSelectedIndex).toBe(0);
    expect(ctx.leadIndex).toBe(1);
  });

  it("does not hijack Space key, allowing global search shortcut to work", () => {
    const ctx = createMockContext(mockItems);
    store.selected = [0];
    const preventDefault = vi.fn();

    ctx.keyEvent({ key: " ", preventDefault });
    // Space should not be prevented or handled by ListingView
    expect(preventDefault).not.toHaveBeenCalled();
    expect(store.selected).toEqual([0]);
  });

  it("navigates with Home and End keys, including Shift + End", () => {
    const ctx = createMockContext(mockItems);
    store.selected = [0];
    store.lastSelectedIndex = 0;
    ctx.leadIndex = 0;

    // Normal End jumps to last item
    ctx.keyEvent({ key: "End", preventDefault: vi.fn() });
    expect(store.selected).toEqual([3]);
    expect(ctx.leadIndex).toBe(3);

    // Normal Home jumps to first item
    ctx.keyEvent({ key: "Home", preventDefault: vi.fn() });
    expect(store.selected).toEqual([0]);
    expect(ctx.leadIndex).toBe(0);

    // Shift + End selects all items from anchor 0 to end (3)
    ctx.keyEvent({ key: "End", shiftKey: true, preventDefault: vi.fn() });
    expect(store.selected).toEqual([0, 1, 2, 3]);
    expect(ctx.leadIndex).toBe(3);
  });

  it("does not intercept keyboard events when focus is inside an input or textarea", () => {
    const ctx = createMockContext(mockItems);
    store.selected = [0];
    const preventDefault = vi.fn();

    ctx.keyEvent({
      key: "ArrowDown",
      target: { tagName: "INPUT" },
      preventDefault,
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mutations.resetSelected).not.toHaveBeenCalled();
  });
});
