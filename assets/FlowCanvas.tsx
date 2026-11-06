import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as errore from "errore";
import { useIsPresent, useReducedMotion } from "motion/react";
import {
  Button,
  Checkbox,
  Crossfade,
  Flex,
  Text,
  backgroundColor,
  border,
  borderColor,
  colors,
  flex,
  focusRing,
  motion,
  radius,
  shadow,
  spacing,
  text,
  useTheme,
} from "maui";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Minus,
  Moon,
  Plus,
  Sidebar,
  Sun,
} from "maui/icons";
import { style, useStyles } from "purse-styles";

const thumbnailPadding = 12;
const thumbnailHeaderHeight = 24;
const thumbnailGap = 8;

export type FlowNode = {
  id: string;
  title: string;
  parent?: string;
  action: string;
  /** Vertical ordering within its column; missing rows do not reserve space. */
  row: number;
  note?: string;
  /** Maximum unscaled preview size; defaults to the scenario dimensions. */
  maxWidth?: number;
  maxHeight?: number;
  render: (context: { mode: "thumbnail" | "preview" }) => ReactNode;
};

export type FlowScenario = {
  id: string;
  title: string;
  description?: string;
  /** Accessible name prefix, for example “Settings flow”. */
  navigationLabel?: string;
  initialState: string;
  /** Parent-first, unique IDs; rows are nonnegative. */
  nodes: readonly FlowNode[];
  dimensions?: {
    nodeWidth?: number;
    nodeHeight?: number;
    previewWidth?: number;
    columnGap?: number;
    rowGap?: number;
  };
  reviewStorageKey?: string;
  /**
   * One interactive preview that stays mounted while the reviewer changes states, instead of
   * remounting `render({ mode: "preview" })` per state. Use it to drive a single live UI from
   * its current state to the selected one. `revision` increases on every selection, including
   * reselecting the current state, so the preview can tell a replay from a move.
   */
  persistentPreview?: (context: {
    selected: string;
    revision: number;
  }) => ReactNode;
};

/**
 * The main scenario is After. IDs identify equivalent states across revisions.
 * Visited preview pages stay mounted in independent Before, After, and unchanged lanes.
 */
export type FlowComparison = {
  before: FlowScenario;
  /** Shared states whose UI or behavior changed; structural differences are derived. */
  modified?: readonly string[];
  beforeLabel?: string;
  afterLabel?: string;
};

const changes = {
  unchanged: "Unchanged",
  modified: "Modified",
  added: "Added",
  removed: "Removed",
};
const changeSuffixes = {
  unchanged: "",
  modified: " ~",
  added: " +",
  removed: " -",
};

class ReviewError extends errore.createTaggedError({
  name: "ReviewError",
  message: "Could not $operation preview reviews.",
}) {}

class LayoutError extends errore.createTaggedError({
  name: "LayoutError",
  message: "Could not $operation sidebar width.",
}) {}

function useSidebarWidth({
  storageKey,
  initialWidth,
}: {
  storageKey: string;
  initialWidth: number;
}) {
  const [width, setWidth] = useState(() => {
    const saved = errore.try({
      try: () => Number(localStorage.getItem(storageKey) ?? initialWidth),
      catch: (cause) => new LayoutError({ operation: "load", cause }),
    });
    if (saved instanceof Error) {
      console.warn(saved);
      return initialWidth;
    }
    return Number.isFinite(saved) && saved > 0 ? saved : initialWidth;
  });
  useEffect(() => {
    const saved = errore.try({
      try: () => localStorage.setItem(storageKey, String(width)),
      catch: (cause) => new LayoutError({ operation: "save", cause }),
    });
    if (saved instanceof Error) console.warn(saved);
  }, [storageKey, width]);
  return [width, setWidth] as const;
}

export function FlowCanvas({
  scenario,
  comparison,
}: {
  scenario: FlowScenario;
  comparison?: FlowComparison;
}) {
  const beforeScenario = comparison?.before;
  const modified = comparison?.modified;
  const beforeNodes = useMemo(
    () => new Map(beforeScenario?.nodes.map((node) => [node.id, node])),
    [beforeScenario?.nodes],
  );
  const afterNodes = useMemo(
    () => new Map(scenario.nodes.map((node) => [node.id, node])),
    [scenario.nodes],
  );
  const steps = useMemo(
    () =>
      beforeScenario
        ? [
            ...scenario.nodes,
            ...beforeScenario.nodes.filter((node) => !afterNodes.has(node.id)),
          ]
        : scenario.nodes,
    [scenario.nodes, beforeScenario, afterNodes],
  );
  const nodeChanges = useMemo(
    () =>
      new Map(
        steps.map((node): [string, keyof typeof changes] => [
          node.id,
          !beforeNodes.has(node.id)
            ? "added"
            : !afterNodes.has(node.id)
              ? "removed"
              : modified?.includes(node.id)
                ? "modified"
                : "unchanged",
        ]),
      ),
    [steps, beforeNodes, afterNodes, modified],
  );
  // Layout uses After's ancestry, with removed branches attached to their old parents.
  // Connections retain each revision's actual ancestry, including rerouted shared states.
  const edges = useMemo(() => {
    const before = beforeScenario?.nodes.filter((node) => node.parent) ?? [];
    const after = scenario.nodes.filter((node) => node.parent);
    const same = (a: FlowNode, b: FlowNode) =>
      a.id === b.id && a.parent === b.parent && a.action === b.action;
    return [
      ...after.map((node) => ({
        node,
        change:
          beforeScenario && !before.some((old) => same(old, node))
            ? "added"
            : "unchanged",
      })),
      ...before
        .filter((node) => !after.some((next) => same(node, next)))
        .map((node) => ({ node, change: "removed" })),
    ];
  }, [scenario.nodes, beforeScenario]);
  const layoutKey = comparison
    ? `${scenario.id}:comparison:${comparison.before.id}`
    : scenario.id;
  const nodeWidth = scenario.dimensions?.nodeWidth ?? 160;
  const nodeHeight = scenario.dimensions?.nodeHeight ?? 212;
  const previewWidth = scenario.dimensions?.previewWidth ?? 440;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useSidebarWidth({
    storageKey: `flow-width:${layoutKey}:outline`,
    initialWidth: 248,
  });
  const [panelWidth, setPanelWidth] = useSidebarWidth({
    storageKey: `flow-width:${layoutKey}:preview`,
    // Include the aside's 20px inset and the panel's 16px inset plus border on both sides.
    initialWidth: comparison
      ? Math.min(previewWidth * 2 + 90, window.innerWidth * 0.52)
      : previewWidth + 40 + 34,
  });
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(window.innerWidth);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setLayoutWidth(entry!.contentRect.width),
    );
    observer.observe(layoutRef.current!);
    return () => observer.disconnect();
  }, []);
  const treeMaximum = Math.max(
    180,
    Math.min(480, layoutWidth - (layoutWidth <= 900 ? 40 : 560)),
  );
  const shownTreeWidth = Math.min(treeMaximum, Math.max(180, treeWidth));
  const panelMaximum = Math.max(
    320,
    Math.min(
      comparison ? 1280 : 960,
      layoutWidth - (sidebarOpen ? shownTreeWidth : 0) - 240,
    ),
  );
  const shownPanelWidth = Math.min(panelMaximum, Math.max(320, panelWidth));
  const contentStyle: CSSProperties & {
    "--flow-preview-width": string;
    "--flow-tree-width": string;
  } = {
    "--flow-preview-width": `${shownPanelWidth}px`,
    "--flow-tree-width": `${shownTreeWidth}px`,
  };
  const [resizing, setResizing] = useState(false);
  const columnGap = scenario.dimensions?.columnGap ?? 56;
  const rowGap = scenario.dimensions?.rowGap ?? 64;
  const label = scenario.navigationLabel ?? "Flow";
  const storageKey = `${scenario.reviewStorageKey ?? `flow-reviewed-v1:${scenario.id}`}${comparison ? `:comparison:${comparison.before.id}` : ""}`;
  const outlineId = `${scenario.id}-flow-outline`;
  const changeDescriptionId = useId();
  const [thumbnailHeights, setThumbnailHeights] = useState<
    Record<string, number>
  >({});
  const [thumbnailHeaderHeights, setThumbnailHeaderHeights] = useState<
    Record<string, number>
  >({});
  const nodes = useMemo(() => {
    const positioned = new Map<
      string,
      FlowNode & { x: number; y: number; height: number; headerHeight: number }
    >();
    for (const step of steps) {
      positioned.set(step.id, {
        ...step,
        x: step.parent
          ? positioned.get(step.parent)!.x + nodeWidth + columnGap
          : 24,
        y: 0,
        height: thumbnailHeights[step.id] ?? nodeHeight,
        headerHeight: thumbnailHeaderHeights[step.id] ?? thumbnailHeaderHeight,
      });
    }
    // Pack each depth independently instead of reserving empty global rows.
    const nextTop = new Map<number, number>();
    // oxlint-disable-next-line unicorn/no-array-sort -- Sort a fresh array without requiring ES2023 browser APIs.
    for (const node of [...positioned.values()].sort((a, b) => a.row - b.row)) {
      node.y =
        (nextTop.get(node.x) ?? 16) +
        thumbnailPadding +
        node.headerHeight +
        thumbnailGap;
      nextTop.set(
        node.x,
        node.y +
          node.height +
          thumbnailPadding +
          Math.max(
            8,
            rowGap -
              thumbnailPadding * 2 -
              thumbnailHeaderHeight -
              thumbnailGap,
          ),
      );
    }
    return positioned;
  }, [
    steps,
    nodeWidth,
    nodeHeight,
    columnGap,
    rowGap,
    thumbnailHeights,
    thumbnailHeaderHeights,
  ]);
  const graphWidth =
    Math.max(...[...nodes.values()].map((node) => node.x)) + nodeWidth + 24;
  const graphHeight =
    Math.max(...[...nodes.values()].map((node) => node.y + node.height)) +
    24 +
    (comparison ? edges.length * 16 + 20 : 0);
  const [selected, setSelected] = useState(scenario.initialState);
  const [journeyEnd, setJourneyEnd] = useState(scenario.initialState);
  const breadcrumbs: string[] = [];
  let ancestor: string | undefined = journeyEnd;
  while (ancestor) {
    breadcrumbs.unshift(ancestor);
    ancestor = nodes.get(ancestor)!.parent;
  }
  const [revision, setRevision] = useState(0);
  const [zoom, setZoom] = useState(comparison ? 0.65 : 0.85);
  const reduceMotion = useReducedMotion();
  const centered = useRef(false);
  const thumbnailRefs = useRef(new Map<string, HTMLDivElement>());
  const thumbnailHeaderRefs = useRef(new Map<string, HTMLDivElement>());
  useLayoutEffect(() => {
    const measure = () => {
      setThumbnailHeights(
        Object.fromEntries(
          steps.map((step) => [
            step.id,
            Math.min(
              nodeHeight,
              (Math.min(
                thumbnailRefs.current.get(step.id)!.offsetHeight,
                step.maxHeight ?? Infinity,
              ) *
                nodeWidth) /
                (step.maxWidth ?? previewWidth),
            ),
          ]),
        ),
      );
      setThumbnailHeaderHeights(
        Object.fromEntries(
          [...thumbnailHeaderRefs.current].map(([id, element]) => [
            id,
            element.offsetHeight,
          ]),
        ),
      );
    };
    const observer = new ResizeObserver(measure);
    for (const step of steps) {
      observer.observe(thumbnailRefs.current.get(step.id)!);
      observer.observe(thumbnailHeaderRefs.current.get(step.id)!);
    }
    measure();
    return () => observer.disconnect();
  }, [steps, nodeHeight, nodeWidth, previewWidth]);
  const select = (id: string) => {
    if (!breadcrumbs.includes(id)) setJourneyEnd(id);
    setSelected(id);
    setRevision((value) => value + 1);
  };
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState<string[]>([]);
  const markReviewed = (id: string, checked: boolean) => {
    const signature = signatures[id];
    if (!signature) return;
    const saved = errore.try({
      try: () => {
        const key = `${storageKey}:${id}`;
        if (checked) localStorage.setItem(key, signature);
        else localStorage.removeItem(key);
      },
      catch: (cause) => new ReviewError({ operation: "save", cause }),
    });
    if (saved instanceof Error) console.warn(saved);
    setReviewed((previous) =>
      checked
        ? [...new Set([...previous, id])]
        : previous.filter((item) => item !== id),
    );
  };
  useEffect(() => {
    // Fingerprint inert thumbnails, not the interactive drafts. Generated IDs,
    // animation frames, and theme values must not invalidate a review.
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void Promise.all(
        steps.map(async (step) => {
          // SAFETY: cloneNode preserves the HTMLDivElement registered by the thumbnail ref.
          const clone = thumbnailRefs.current
            .get(step.id)!
            .cloneNode(true) as HTMLElement;
          for (const element of [clone, ...clone.querySelectorAll("*")]) {
            for (const attribute of element.getAttributeNames()) {
              if (
                attribute === "id" ||
                attribute === "data-alive" ||
                /^(aria-labelledby|aria-describedby|aria-controls|aria-owns|aria-activedescendant)$/.test(
                  attribute,
                )
              )
                element.removeAttribute(attribute);
            }
            if (element instanceof HTMLElement) {
              element.style.removeProperty("opacity");
              element.style.removeProperty("transform");
              if (
                element.tagName === "DIV" &&
                element.closest("[aria-busy='true']")
              )
                element.style.removeProperty("height");
              if (element.getAttribute("style") === "")
                element.removeAttribute("style");
            }
          }
          const before = beforeNodes.get(step.id);
          const bytes = new TextEncoder().encode(
            `${step.action}:${clone.innerHTML}${beforeScenario ? JSON.stringify([before?.parent, before?.action, afterNodes.get(step.id)?.parent, nodeChanges.get(step.id)]) : ""}`,
          );
          const digest = await crypto.subtle
            .digest("SHA-256", bytes)
            .catch(
              (cause) => new ReviewError({ operation: "fingerprint", cause }),
            );
          if (digest instanceof Error) return digest;
          return [
            step.id,
            [...new Uint8Array(digest)]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join(""),
          ] as const;
        }),
      )
        .then((entries) => {
          if (cancelled) return;
          const validEntries = entries.filter(
            (entry): entry is readonly [string, string] => {
              if (entry instanceof Error) {
                console.warn(entry);
                return false;
              }
              return true;
            },
          );
          const nextSignatures = Object.fromEntries(validEntries);
          setSignatures(nextSignatures);
          const stored = errore.try({
            try: () =>
              validEntries
                .filter(
                  ([id, signature]) =>
                    localStorage.getItem(`${storageKey}:${id}`) === signature,
                )
                .map(([id]) => id),
            catch: (cause) => new ReviewError({ operation: "load", cause }),
          });
          if (stored instanceof Error) {
            console.warn(stored);
            return;
          }
          setReviewed(stored);
        })
        .catch((cause) =>
          console.warn(new ReviewError({ operation: "fingerprint", cause })),
        );
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [steps, storageKey, beforeScenario, beforeNodes, afterNodes, nodeChanges]);
  const { resolvedTheme, setPreference } = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const previewScroller = useRef<HTMLElement>(null);
  const page = useStyles(styles.page);
  const header = useStyles(styles.header);
  const content = useStyles(styles.content, !sidebarOpen && styles.collapsed);
  const sidebarToggle = useStyles(
    styles.sidebarToggle,
    !sidebarOpen && styles.toggleCollapsed,
  );
  const treeSlot = useStyles(styles.treeSlot);
  const tree = useStyles(styles.tree, !sidebarOpen && styles.treeClosed);
  const treeList = useStyles(styles.treeList);
  const treeRow = useStyles(styles.treeRow);
  const treeButton = useStyles(styles.treeButton);
  const mapPane = useStyles(styles.mapPane);
  const map = useStyles(styles.map);
  const graph = useStyles(styles.graph);
  const nodeStyle = useStyles(styles.node);
  const thumbnail = useStyles(styles.thumbnail);
  const reviewedMark = useStyles(styles.reviewedMark);
  const hit = useStyles(styles.hit);
  const nodeHeader = useStyles(styles.nodeHeader);
  const nodeBody = useStyles(styles.nodeBody);
  const reviewCheckbox = useStyles(styles.reviewCheckbox);
  const edge = useStyles(styles.edge);
  const preview = useStyles(styles.preview);
  const previewPanel = useStyles(styles.previewPanel);
  const comparisonColumns = useStyles(styles.comparisonColumns);
  const edgeStyle = useStyles(styles.comparisonEdge);
  const persistentPreviewLayout = useStyles(styles.persistentPreviewLayout);
  const navigationButton = useStyles(styles.navigationButton);
  const title = useStyles(text({ size: "lg", fontWeight: 600 }));
  const current = nodes.get(selected)!;
  const sharedPreview = comparison && nodeChanges.get(selected) === "unchanged";
  const previewInset = `max(${spacing.value(8)}, calc((100cqw - ${current.maxWidth ?? previewWidth}px - 2px) / 2))`;
  const next = steps.filter((step) => step.parent === selected);
  const path = new Set(breadcrumbs.slice(0, breadcrumbs.indexOf(selected) + 1));

  useLayoutEffect(() => {
    const viewport = scroller.current!;
    viewport.scrollTo({
      behavior: !centered.current || reduceMotion ? "instant" : "smooth",
      left: Math.max(
        0,
        (current.x + nodeWidth / 2) * zoom - viewport.clientWidth / 2,
      ),
      top: Math.max(
        0,
        (current.y + current.height / 2) * zoom - viewport.clientHeight / 2,
      ),
    });
    centered.current = true;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Reselecting/resetting a state recenters its thumbnail too.
  }, [zoom, current, revision, reduceMotion, nodeWidth]);

  useLayoutEffect(() => {
    previewScroller.current!.scrollTop = 0;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Selection and explicit reset both restore the preview scroll position.
  }, [selected, revision]);

  const renderTree = (parent?: string): ReactNode => (
    <ul className={treeList}>
      {steps
        .filter((step) => step.parent === parent)
        .map((step) => {
          return (
            <li key={step.id}>
              <div
                className={treeRow}
                data-selected={selected === step.id}
                data-change={comparison ? nodeChanges.get(step.id) : undefined}
                title={
                  comparison ? changes[nodeChanges.get(step.id)!] : undefined
                }
              >
                <Button
                  className={treeButton}
                  variant="quiet"
                  aria-current={selected === step.id ? "step" : undefined}
                  aria-describedby={
                    comparison
                      ? `${changeDescriptionId}-${nodeChanges.get(step.id)}`
                      : undefined
                  }
                  onPress={() => select(step.id)}
                >
                  <span data-flow-title>
                    {comparison && nodeChanges.get(step.id) !== "unchanged" && (
                      <span aria-hidden="true">
                        {changeSuffixes[nodeChanges.get(step.id)!].trim()}{" "}
                      </span>
                    )}
                    {step.title}
                  </span>
                </Button>
                <div
                  className={reviewCheckbox}
                  role="group"
                  aria-label={`Review in tree: ${step.title}`}
                >
                  <Checkbox
                    label="Reviewed"
                    checked={reviewed.includes(step.id)}
                    setChecked={(checked: boolean) =>
                      markReviewed(step.id, checked)
                    }
                  />
                </div>
              </div>
              {steps.some((child) => child.parent === step.id) &&
                renderTree(step.id)}
            </li>
          );
        })}
    </ul>
  );

  const previewHeader = (
    <Flex column gap={4}>
      <Flex row justifyContent="between" alignItems="center" gap={4}>
        <h2 className={title} style={{ margin: 0 }}>
          {current.title}
        </h2>
        <div className={reviewCheckbox}>
          <Checkbox
            label="Reviewed"
            checked={reviewed.includes(selected)}
            setChecked={(checked: boolean) => markReviewed(selected, checked)}
          />
        </div>
      </Flex>
      {!comparison && current.note && (
        <Text size="sm" color="lowContrast">
          {current.note}
        </Text>
      )}
    </Flex>
  );
  const previewPanelFor = (
    ui: ReactNode,
    key: string,
    node: FlowNode = current,
  ) => (
    <div
      key={key}
      className={previewPanel}
      style={{
        padding: comparison ? spacing.value(8) : previewInset,
        maxHeight: `calc(${node.maxHeight ?? (nodeHeight * (node.maxWidth ?? previewWidth)) / nodeWidth}px + ${comparison ? spacing.value(8) : previewInset} * 2 + 2px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: node.maxWidth ?? previewWidth,
          flexShrink: 0,
        }}
      >
        {ui}
      </div>
    </div>
  );
  const previewNavigation = (
    <Flex row gap={4} alignItems="start" style={{ flexWrap: "wrap" }}>
      {current.parent && (
        <Button
          className={navigationButton}
          onPress={() => select(current.parent!)}
        >
          <ArrowLeft />
          Previous state
        </Button>
      )}
      <Flex
        row
        gap={4}
        justifyContent="end"
        style={{ flex: 1, minWidth: 0, flexWrap: "wrap" }}
      >
        {next.map((step) => (
          <Button
            key={step.id}
            aria-label={`Follow flow: ${step.action}`}
            className={navigationButton}
            onPress={() => select(step.id)}
          >
            {step.action}
            <ArrowRight />
          </Button>
        ))}
      </Flex>
    </Flex>
  );
  return (
    <main className={page}>
      {comparison &&
        Object.entries(changes).map(([change, description]) => (
          <span key={change} id={`${changeDescriptionId}-${change}`} hidden>
            {description}
          </span>
        ))}
      <header className={header}>
        <Flex column gap={3}>
          <h1 className={title}>{scenario.title}</h1>
          {scenario.description && (
            <Text size="xs" color="lowContrast">
              {scenario.description}
            </Text>
          )}
        </Flex>
        <Button
          onPress={() =>
            setPreference(resolvedTheme === "dark" ? "light" : "dark")
          }
          aria-label="Toggle theme"
        >
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}
          {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        </Button>
      </header>
      <div
        ref={layoutRef}
        className={content}
        data-sidebar-open={sidebarOpen}
        data-resizing={resizing}
        style={contentStyle}
      >
        <Button
          className={sidebarToggle}
          variant="quiet"
          aria-label="Toggle flow sidebar"
          aria-expanded={sidebarOpen}
          aria-controls={outlineId}
          onPress={() => setSidebarOpen((open) => !open)}
        >
          <Sidebar size="sm" />
        </Button>
        <div className={treeSlot}>
          <nav
            id={outlineId}
            className={tree}
            aria-label={`${label} outline`}
            inert={!sidebarOpen}
            aria-hidden={!sidebarOpen}
          >
            {renderTree()}
          </nav>
        </div>
        {sidebarOpen && (
          <SidebarResizeHandle
            side="left"
            label="Resize flow outline"
            value={shownTreeWidth}
            minimum={180}
            maximum={treeMaximum}
            setValue={setTreeWidth}
            onResizingChange={setResizing}
          />
        )}
        <SidebarResizeHandle
          side="right"
          label="Resize state preview"
          value={shownPanelWidth}
          minimum={320}
          maximum={panelMaximum}
          setValue={setPanelWidth}
          onResizingChange={setResizing}
        />
        <section className={mapPane} aria-label={`${label} map`}>
          <Flex
            row
            justifyContent="end"
            alignItems="center"
            px={8}
            py={4}
            style={{ flexWrap: "wrap", gap: 8 }}
          >
            <Flex row gap={3} alignItems="center">
              <Button
                size="sm"
                aria-label="Zoom out"
                isDisabled={zoom <= 0.45}
                onPress={() => setZoom((value) => Math.max(0.45, value - 0.1))}
              >
                <Minus />
              </Button>
              <Text size="xs" tabular>
                {Math.round(zoom * 100)}%
              </Text>
              <Button
                size="sm"
                aria-label="Zoom in"
                isDisabled={zoom >= 1.15}
                onPress={() => setZoom((value) => Math.min(1.15, value + 0.1))}
              >
                <Plus />
              </Button>
              <Button size="sm" onPress={() => select(scenario.initialState)}>
                Start
              </Button>
            </Flex>
          </Flex>
          <div
            className={map}
            ref={scroller}
            tabIndex={0}
            aria-label="Scrollable flow map"
          >
            <div
              style={{ width: graphWidth * zoom, height: graphHeight * zoom }}
            >
              <nav
                className={graph}
                aria-label={`${label} states`}
                style={{
                  width: graphWidth,
                  height: graphHeight,
                  transform: `scale(${zoom})`,
                }}
              >
                <svg
                  aria-hidden="true"
                  width={graphWidth}
                  height={graphHeight}
                  style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                  }}
                >
                  {edges.map(({ node: step, change }, index) => {
                    const from = nodes.get(step.parent!)!;
                    const to = nodes.get(step.id)!;
                    const startX = from.x + nodeWidth;
                    const offset =
                      comparison && change !== "unchanged"
                        ? change === "added"
                          ? -4
                          : 4
                        : 0;
                    const startY = from.y + from.height / 2 + offset;
                    const endY = to.y + to.height / 2 + offset;
                    const elbow = startX + columnGap / 2;
                    const rail = graphHeight - 20 - index * 16;
                    const route =
                      comparison && to.x !== from.x + nodeWidth + columnGap
                        ? `M ${startX} ${startY} H ${startX + columnGap / 3} V ${rail} H ${to.x - columnGap / 3} V ${endY} H ${to.x - 8}`
                        : `M ${startX} ${startY} H ${elbow} V ${endY} H ${to.x - 8}`;
                    return (
                      <path
                        key={`${step.parent}:${step.id}:${change}`}
                        className={comparison ? edgeStyle : edge}
                        data-flow-edge={`${step.parent}:${step.id}`}
                        data-change={comparison ? change : undefined}
                        data-action={step.action}
                        d={`${route} l -5 -4 m 5 4 l -5 4`}
                        fill="none"
                        stroke={
                          !comparison && path.has(step.id)
                            ? colors.accent[8]
                            : colors.gray[8]
                        }
                        strokeWidth={!comparison && path.has(step.id) ? 2 : 1.5}
                      />
                    );
                  })}
                </svg>
                {steps.map((step) => {
                  const node = nodes.get(step.id)!;
                  return (
                    <div
                      key={step.id}
                      className={nodeStyle}
                      data-selected={selected === step.id}
                      data-change={
                        comparison ? nodeChanges.get(step.id) : undefined
                      }
                      title={
                        comparison
                          ? changes[nodeChanges.get(step.id)!]
                          : undefined
                      }
                      style={{
                        left: node.x - thumbnailPadding,
                        top:
                          node.y -
                          thumbnailPadding -
                          node.headerHeight -
                          thumbnailGap,
                        width: nodeWidth + thumbnailPadding * 2,
                        height:
                          node.height +
                          thumbnailPadding * 2 +
                          node.headerHeight +
                          thumbnailGap,
                      }}
                    >
                      <div
                        className={nodeHeader}
                        ref={(element) => {
                          if (element)
                            thumbnailHeaderRefs.current.set(step.id, element);
                          else thumbnailHeaderRefs.current.delete(step.id);
                        }}
                      >
                        <Text
                          data-flow-title
                          size="sm"
                          fontWeight={500}
                          style={{ flex: 1 }}
                        >
                          {step.title}
                          {comparison && (
                            <span aria-hidden="true">
                              {changeSuffixes[nodeChanges.get(step.id)!]}
                            </span>
                          )}
                        </Text>
                        <div
                          className={reviewCheckbox}
                          role="group"
                          aria-label={`Review ${step.title}`}
                        >
                          <Checkbox
                            label="Reviewed"
                            checked={reviewed.includes(step.id)}
                            setChecked={(checked: boolean) =>
                              markReviewed(step.id, checked)
                            }
                          />
                        </div>
                      </div>
                      <div className={nodeBody} style={{ height: node.height }}>
                        <div
                          className={thumbnail}
                          data-reviewed={reviewed.includes(step.id)}
                          aria-hidden="true"
                          inert
                        >
                          <div
                            ref={(element) => {
                              if (element)
                                thumbnailRefs.current.set(step.id, element);
                              else thumbnailRefs.current.delete(step.id);
                            }}
                            style={{
                              width: step.maxWidth ?? previewWidth,
                              transform: `scale(${nodeWidth / (step.maxWidth ?? previewWidth)})`,
                              transformOrigin: "top left",
                            }}
                          >
                            {step.render({ mode: "thumbnail" })}
                            {comparison &&
                              beforeNodes.has(step.id) &&
                              afterNodes.has(step.id) && (
                                <div hidden>
                                  {beforeNodes
                                    .get(step.id)!
                                    .render({ mode: "thumbnail" })}
                                </div>
                              )}
                          </div>
                        </div>
                        {reviewed.includes(step.id) && (
                          <div
                            className={reviewedMark}
                            role="img"
                            aria-label={`Reviewed: ${step.title}`}
                          >
                            <Check size="lg" aria-hidden="true" />
                          </div>
                        )}
                      </div>
                      <Button
                        className={hit}
                        data-flow-state={step.id}
                        aria-label={`Preview ${step.title}`}
                        aria-describedby={
                          comparison
                            ? `${changeDescriptionId}-${nodeChanges.get(step.id)}`
                            : undefined
                        }
                        aria-pressed={selected === step.id}
                        onPress={() => select(step.id)}
                      >
                        {undefined}
                      </Button>
                    </div>
                  );
                })}
              </nav>
            </div>
          </div>
        </section>
        <aside
          className={preview}
          ref={previewScroller}
          aria-label="Selected state preview"
          aria-description={
            comparison ? changes[nodeChanges.get(selected)!] : undefined
          }
        >
          {comparison ? (
            previewHeader
          ) : (
            <nav aria-label="State path">
              <ol
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                }}
              >
                {breadcrumbs.map((id, index) => (
                  <li
                    key={id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      minWidth: 0,
                      maxWidth: "100%",
                    }}
                  >
                    {index > 0 && (
                      <ChevronRight
                        size="xs"
                        aria-hidden="true"
                        style={{ flexShrink: 0 }}
                      />
                    )}
                    <Button
                      variant="quiet"
                      variantColor={id === selected ? "accent" : undefined}
                      aria-current={id === selected ? "step" : undefined}
                      style={{
                        whiteSpace: "normal",
                        height: "auto",
                        minHeight: 24,
                        textAlign: "left",
                      }}
                      onPress={() => select(id)}
                    >
                      {nodes.get(id)!.title}
                    </Button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {comparison ? (
            <div
              className={comparisonColumns}
              style={
                sharedPreview
                  ? { gridTemplateColumns: "minmax(0, 1fr)" }
                  : undefined
              }
            >
              <ComparisonPreview
                scenario={comparison.before}
                label={comparison.beforeLabel ?? "Before"}
                labelColor={colors.red[11]}
                hidden={sharedPreview}
                selected={selected}
                revision={revision}
                select={select}
                renderPanel={previewPanelFor}
              />
              <ComparisonPreview
                scenario={scenario}
                label={comparison.afterLabel ?? "After"}
                labelColor={colors.green[11]}
                hidden={sharedPreview}
                selected={selected}
                revision={revision}
                select={select}
                renderPanel={previewPanelFor}
              />
              <ComparisonPreview
                scenario={scenario}
                label="Shared state"
                labelColor={colors.gray[11]}
                shared
                hidden={!sharedPreview}
                selected={selected}
                revision={revision}
                select={select}
                renderPanel={previewPanelFor}
              />
            </div>
          ) : scenario.persistentPreview ? (
            <div className={persistentPreviewLayout}>
              <Crossfade
                contentKey={selected}
                direction="up"
                style={{ overflow: "visible" }}
              >
                <PreviewScene>{previewHeader}</PreviewScene>
              </Crossfade>
              {previewPanelFor(
                scenario.persistentPreview({ selected, revision }),
                "persistent",
              )}
              <Crossfade
                contentKey={selected}
                direction="up"
                style={{ overflow: "visible" }}
              >
                <PreviewScene>{previewNavigation}</PreviewScene>
              </Crossfade>
            </div>
          ) : (
            <Crossfade
              contentKey={selected}
              direction="up"
              style={{
                minHeight: 0,
                gridTemplateRows: "minmax(0, 1fr)",
                overflow: "visible",
              }}
            >
              <PreviewScene>
                {previewHeader}
                {previewPanelFor(
                  current.render({ mode: "preview" }),
                  `${selected}-${revision}`,
                )}
                {previewNavigation}
              </PreviewScene>
            </Crossfade>
          )}
        </aside>
      </div>
    </main>
  );
}

function PreviewScene({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const scene = useStyles(styles.scene);
  return (
    <div className={scene} inert={!present} aria-hidden={!present}>
      {children}
    </div>
  );
}

/** Each lane retains visited pages; hidden lanes do not advance their live instance. */
function ComparisonPreview({
  scenario,
  label,
  labelColor,
  hidden,
  shared,
  selected,
  revision,
  select,
  renderPanel,
}: {
  scenario: FlowScenario;
  label: string;
  labelColor: string;
  hidden?: boolean;
  shared?: boolean;
  selected: string;
  revision: number;
  select: (id: string) => void;
  renderPanel: (ui: ReactNode, key: string, node: FlowNode) => ReactNode;
}) {
  const side = useStyles(styles.comparisonSide);
  const navigationButton = useStyles(styles.navigationButton);
  const current = scenario.nodes.find((node) => node.id === selected);
  const active = !hidden && !!current;
  const [visited, setVisited] = useState<string[]>([]);
  if (active && !visited.includes(selected)) {
    setVisited([...visited, selected]);
  }
  const [lastPresent, setLastPresent] = useState({
    selected: scenario.initialState,
    revision: 0,
    observedRevision: revision,
    active,
  });
  if (
    active !== lastPresent.active ||
    (active &&
      (lastPresent.selected !== selected ||
        lastPresent.observedRevision !== revision))
  ) {
    setLastPresent({
      selected: active ? selected : lastPresent.selected,
      // Resuming the same frozen state is not an explicit replay.
      revision:
        active && (lastPresent.active || lastPresent.selected !== selected)
          ? revision
          : lastPresent.revision,
      observedRevision: revision,
      active,
    });
  }
  const context = {
    selected: lastPresent.selected,
    revision: lastPresent.revision,
  };
  const retained = scenario.nodes.find((node) => node.id === context.selected)!;
  const ancestors: FlowNode[] = [];
  let ancestor = current;
  while (ancestor) {
    ancestors.unshift(ancestor);
    ancestor = scenario.nodes.find((node) => node.id === ancestor!.parent);
  }
  return (
    <section
      className={side}
      aria-label={shared ? "Shared state" : label}
      hidden={hidden}
      style={hidden ? { display: "none" } : undefined}
    >
      <Flex column gap={3}>
        {!shared && (
          <Text size="sm" fontWeight={600} style={{ color: labelColor }}>
            {label}
          </Text>
        )}
        {current && (
          <nav aria-label={`${shared ? "Shared" : label} state path`}>
            <Flex row gap={1} style={{ flexWrap: "wrap" }}>
              {ancestors.map((node, index) => (
                <Flex row alignItems="center" key={node.id}>
                  {index > 0 && <ChevronRight size="xs" aria-hidden="true" />}
                  <Button
                    variant="quiet"
                    aria-current={node.id === selected ? "step" : undefined}
                    variantColor={node.id === selected ? "accent" : undefined}
                    onPress={() => select(node.id)}
                    style={{
                      whiteSpace: "normal",
                      height: "auto",
                      minHeight: 24,
                      textAlign: "left",
                    }}
                  >
                    {node.title}
                  </Button>
                </Flex>
              ))}
            </Flex>
          </nav>
        )}
        {current?.note && (
          <Text size="sm" color="lowContrast">
            {current.note}
          </Text>
        )}
      </Flex>
      {scenario.persistentPreview && !shared ? (
        <div hidden={!current} inert={!current} aria-hidden={!current}>
          {renderPanel(
            scenario.persistentPreview(context),
            "persistent",
            retained,
          )}
        </div>
      ) : (
        visited.map((id) => {
          const node = scenario.nodes.find((candidate) => candidate.id === id);
          if (!node) return null;
          const inactive = !active || selected !== id;
          return (
            <div key={id} hidden={inactive} inert={inactive}>
              {renderPanel(node.render({ mode: "preview" }), id, node)}
            </div>
          );
        })
      )}
      {!current && <Text color="lowContrast">Not present in {label}.</Text>}
      {current && (
        <Flex row gap={4} alignItems="start" style={{ flexWrap: "wrap" }}>
          {current.parent && (
            <Button
              className={navigationButton}
              onPress={() => select(current.parent!)}
            >
              <ArrowLeft />
              Previous state
            </Button>
          )}
          <Flex
            row
            gap={4}
            justifyContent="end"
            style={{ flex: 1, flexWrap: "wrap", minWidth: 0 }}
          >
            {scenario.nodes
              .filter((node) => node.parent === selected)
              .map((node) => (
                <Button
                  key={node.id}
                  className={navigationButton}
                  aria-label={`Follow flow: ${node.action}`}
                  onPress={() => select(node.id)}
                >
                  {node.action}
                  <ArrowRight />
                </Button>
              ))}
          </Flex>
        </Flex>
      )}
    </section>
  );
}

function SidebarResizeHandle({
  side,
  label,
  value,
  minimum,
  maximum,
  setValue,
  onResizingChange,
}: {
  side: "left" | "right";
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  setValue: (width: number) => void;
  onResizingChange: (resizing: boolean) => void;
}) {
  const handle = useStyles(styles.resizeHandle);
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const direction = side === "left" ? 1 : -1;
  const resize = (width: number) =>
    setValue(Math.max(minimum, Math.min(maximum, width)));
  return (
    <div
      className={handle}
      data-side={side}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: value };
        onResizingChange(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        resize(
          drag.current.width + direction * (event.clientX - drag.current.x),
        );
      }}
      onLostPointerCapture={() => {
        drag.current = undefined;
        onResizingChange(false);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        resize(
          event.key === "Home"
            ? minimum
            : event.key === "End"
              ? maximum
              : value + (event.key === "ArrowRight" ? 16 : -16) * direction,
        );
      }}
    />
  );
}

const dottedBackground = style({
  backgroundColor: colors.gray[1],
  backgroundImage: `radial-gradient(${colors.grayAlpha[3]} 1px, transparent 1px)`,
  backgroundSize: "12px 12px",
});

function changeStyles(
  change: "added" | "removed" | "modified",
  scale: typeof colors.red,
) {
  const marked = `&[data-change='${change}']`;
  return {
    [`${marked} [data-flow-title]`]: { color: scale[11] },
  };
}

const styles = {
  page: style({
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: backgroundColor.app,
    overflow: "hidden",
  }),
  header: style({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.value(4),
    padding: "16px 20px",
    borderBottom: `1px solid ${borderColor.border}`,
    flexShrink: 0,
  }),
  content: style(motion.standard("grid-template-columns"), {
    position: "relative",
    display: "grid",
    gridTemplateColumns:
      "var(--flow-tree-width) minmax(0, 1fr) var(--flow-preview-width)",
    minHeight: 0,
    flex: 1,
    "&[data-resizing='true']": {
      transition: "none",
      userSelect: "none",
      cursor: "col-resize",
    },
    "@media (max-width: 900px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(240px, 40dvh) minmax(0, 1fr)",
    },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }),
  collapsed: style({
    gridTemplateColumns: "0px minmax(0, 1fr) var(--flow-preview-width)",
    "@media (max-width: 900px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  }),
  sidebarToggle: style(motion.standard("left"), {
    "&&": {
      position: "absolute",
      left: "calc(var(--flow-tree-width) - 40px)",
      top: 10,
      zIndex: 30,
    },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }),
  toggleCollapsed: style({ "&&": { left: 12 } }),
  treeClosed: style({ transform: "translateX(-100%)", opacity: 0 }),
  treeSlot: style({
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    "@media (max-width: 900px)": {
      position: "absolute",
      left: 0,
      top: 0,
      height: "40dvh",
      width: "var(--flow-tree-width)",
      zIndex: 20,
      pointerEvents: "none",
    },
  }),
  tree: style(motion.standard("transform", "opacity"), {
    width: "var(--flow-tree-width)",
    height: "100%",
    boxSizing: "border-box",
    overflow: "auto",
    padding: "48px 8px 12px",
    backgroundColor: backgroundColor.element,
    borderRight: `1px solid ${borderColor.border}`,
    "@media (max-width: 900px)": { pointerEvents: "auto" },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }),
  treeList: style({
    listStyle: "none",
    margin: 0,
    padding: 0,
    "& ul": {
      marginLeft: 8,
      paddingLeft: 6,
      borderLeft: `1px solid ${borderColor.border}`,
    },
  }),
  treeRow: style(radius.sm, {
    display: "flex",
    alignItems: "center",
    gap: 4,
    paddingRight: spacing.value(3),
    "&[data-selected='true']": {
      backgroundColor: backgroundColor.elementHover,
    },
    ...changeStyles("added", colors.green),
    ...changeStyles("removed", colors.red),
    ...changeStyles("modified", colors.amber),
  }),
  treeButton: style({
    "&&": {
      flex: 1,
      minWidth: 0,
      height: "auto",
      minHeight: 32,
      whiteSpace: "normal",
      textAlign: "left",
      justifyContent: "start",
      padding: "6px",
      fontSize: 12,
    },
    "&&[aria-current='step']": {
      color: colors.accent[11],
    },
  }),
  mapPane: style({
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    borderRight: `1px solid ${borderColor.border}`,
  }),
  map: style(dottedBackground, {
    flex: 1,
    overflow: "auto",
    minHeight: 0,
    position: "relative",
  }),
  graph: style(motion.standard("transform"), {
    position: "relative",
    transformOrigin: "top left",
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }),
  edge: style(motion.standard("stroke", "stroke-width"), {
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }),
  comparisonEdge: style({
    "&[data-change='added']": {
      stroke: colors.green[9],
    },
    "&[data-change='removed']": {
      stroke: colors.red[9],
      strokeDasharray: "5 3",
    },
  }),
  comparisonColumns: style({
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
    gridAutoRows: "max-content",
    alignContent: "start",
    gap: 16,
    minWidth: 0,
  }),
  comparisonSide: style({
    display: "grid",
    gridRow: "span 3",
    gridTemplateRows: "subgrid",
    alignItems: "start",
    alignContent: "start",
    gap: 12,
    minWidth: 0,
  }),
  node: style(radius.lg, shadow.subtle, {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    padding: thumbnailPadding,
    gap: thumbnailGap,
    backgroundColor: backgroundColor.element,
    "&:hover": { backgroundColor: backgroundColor.elementHover },
    "&[data-selected='true']": {
      backgroundColor: colors.accent[3],
      boxShadow: `0 0 0 1px ${colors.accentAlpha[7]}, 0 1px 1px -0.5px ${colors.grayAlpha[3]}, 0 3px 3px -1.5px ${colors.grayAlpha[3]}`,
    },
    "&[data-selected='true'] [data-flow-title]": {
      color: colors.accent[12],
      fontWeight: 600,
    },
    ...changeStyles("added", colors.green),
    ...changeStyles("removed", colors.red),
    ...changeStyles("modified", colors.amber),
  }),
  nodeBody: style({ position: "relative", flexShrink: 0 }),
  thumbnail: style(motion.standard("opacity"), {
    position: "absolute",
    inset: 0,
    overflow: "clip",
    overflowClipMargin: spacing.value(2),
    pointerEvents: "none",
    "&[data-reviewed='true']": { opacity: 0.35 },
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  }),
  reviewedMark: style(
    radius.circle,
    shadow.subtle,
    text({ color: "onAccent" }),
    {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: 40,
      height: 40,
      display: "grid",
      placeItems: "center",
      backgroundColor: colors.green[9],
      pointerEvents: "none",
    },
  ),
  hit: style(focusRing("&&:focus-visible"), {
    "&&": {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      padding: 0,
      backgroundColor: "transparent",
      boxShadow: "none",
      border: "none",
      borderRadius: 0,
      cursor: "pointer",
    },
    "&&:hover:not(:disabled), &&[data-hovered], &&[data-pressed]": {
      backgroundColor: "transparent",
    },
    "&&:focus-visible": { position: "absolute" },
  }),
  nodeHeader: style({
    minHeight: thumbnailHeaderHeight,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spacing.value(3),
    pointerEvents: "none",
    "& > [role='group']": {
      pointerEvents: "auto",
      position: "relative",
      zIndex: 2,
    },
  }),
  reviewCheckbox: style({
    flexShrink: 0,
    "& label > span:last-child": {
      position: "absolute",
      width: 1,
      height: 1,
      overflow: "hidden",
      clipPath: "inset(50%)",
      whiteSpace: "nowrap",
    },
  }),
  preview: style({
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
    padding: 20,
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    gap: 16,
    backgroundColor: backgroundColor.element,
  }),
  previewPanel: style(
    flex({
      direction: "column",
      alignItems: "center",
      justifyContent: "start",
    }),
    dottedBackground,
    spacing.padding({ all: 8 }),
    border([], "outline"),
    radius.xl,
    {
      width: "100%",
      justifySelf: "center",
      minWidth: 0,
      minHeight: 0,
      overflow: "auto",
    },
  ),
  navigationButton: style({
    "&&": {
      height: "auto",
      minHeight: 32,
      maxWidth: "100%",
      whiteSpace: "normal",
      textAlign: "left",
    },
  }),
  resizeHandle: style(focusRing(), {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 8,
    zIndex: 25,
    cursor: "col-resize",
    touchAction: "none",
    "&[data-side='left']": { left: "calc(var(--flow-tree-width) - 4px)" },
    "&[data-side='right']": { right: "calc(var(--flow-preview-width) - 4px)" },
    "&::before": {
      content: '""',
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 3,
      width: 1,
      pointerEvents: "none",
    },
    "&:hover::before, &:focus-visible::before, &:active::before": {
      backgroundColor: colors.green[9],
    },
    // Maui's focus ring uses relative positioning; handles must stay outside the grid flow.
    "&:focus-visible": { position: "absolute", zIndex: 25 },
    "@media (max-width: 900px)": { display: "none" },
  }),
  // Auto rows so the crossfading header and navigation keep their content height around the
  // mounted panel; the inline-size container keeps the panel's `cqw` inset relative to the
  // sidebar, as it is inside a scene.
  persistentPreviewLayout: style({
    display: "grid",
    containerType: "inline-size",
    gridTemplateRows: "auto auto auto",
    alignContent: "start",
    gap: 16,
    minWidth: 0,
  }),
  scene: style({
    display: "grid",
    containerType: "inline-size",
    height: "100%",
    minHeight: 0,
    gridTemplateRows: "auto minmax(0, max-content) auto",
    alignContent: "start",
    gap: 16,
    "@media (max-width: 900px)": { height: "max-content" },
  }),
};
