export { Button, type ButtonProps } from "./components/button.js"
export { IconButton, type IconButtonProps } from "./components/icon-button.js"
export { Spinner } from "./components/spinner.js"
export {
  Card,
  CardTitle,
  CardDescription,
  CardActions,
  type CardProps,
  type CardTitleProps,
} from "./components/card.js"
export { Tag, type TagProps } from "./components/tag.js"
export { Icon, type IconProps, type IconName } from "./components/icon.js"
export { Mark, Splash, Logo } from "./components/logo.js"
export { Avatar, type AvatarProps } from "./components/avatar.js"
export { Collapsible } from "./components/collapsible.js"
export { Keybind, type KeybindProps } from "./components/keybind.js"
export { cn } from "./lib/utils.js"
export {
  CommandPalette,
  type CommandPaletteProps,
  type CommandItem,
  type CommandGroup,
} from "./components/command-palette.js"
export { DiffViewer, type DiffViewerProps, type DiffLine } from "./components/diff-viewer.js"
export { ColorPicker, type ColorPickerProps } from "./components/color-picker.js"

// Additional ports from OpenCode
export { ImagePreview, type ImagePreviewProps } from "./components/image-preview.js"
export { AppIcon, type AppIconName, type AppIconProps } from "./components/app-icon.js"
export { Favicon } from "./components/favicon.js"
export {
  ProviderIcon,
  type ProviderIconName,
  type ProviderIconProps,
} from "./components/provider-icon.js"
export {
  FileIcon,
  chooseIconName,
  type FileIconProps,
  type FileIconNode,
  type FileIconName,
} from "./components/file-icon.js"
export { useSpring } from "./components/motion-spring.js"
export {
  LineComment,
  LineCommentAdd,
  LineCommentEditor,
  type LineCommentProps,
  type LineCommentEditorProps,
  type LineCommentAnchorProps,
  type LineCommentVariant,
} from "./components/line-comment.js"
export {
  createLineCommentAnnotationRenderer,
  useLineCommentAnnotations,
  useLineCommentController,
  useManagedAnnotationRenderer,
  type LineCommentAnnotationMeta,
  type LineCommentAnnotation,
  type LineCommentShape,
  type LineCommentSelection,
  type CommentProps,
  type DraftProps,
  type LineCommentAnnotationsProps,
  type LineCommentControllerProps,
  type LineCommentControllerApi,
} from "./components/line-comment-annotations.js"
export { Markdown, type MarkdownProps } from "./components/markdown.js"
export {
  DiffChanges,
  type DiffChangesProps,
  type DiffChangesSingle,
} from "./components/diff-changes-v2.js"
export {
  LineCommentV2,
  LineCommentEditorV2,
  LineCommentV2OverflowIcon,
  type LineCommentV2Props,
  type LineCommentEditorV2Props,
} from "./components/line-comment-v2.js"
export {
  BasicToolV2,
  type BasicToolV2Props,
  type BasicToolV2TriggerTitle,
} from "./components/basic-tool-v2.js"
export { ToolErrorCardV2, type ToolErrorCardV2Props } from "./components/tool-error-card-v2.js"
export { KeybindV2, type KeybindV2Props } from "./components/keybind-v2.js"
export { TabStateIndicator, type TabStateIndicatorProps } from "./components/tab-state-indicator.js"
export { TextShimmerV2, type TextShimmerV2Props } from "./components/text-shimmer-v2.js"
export { WordmarkV2, type WordmarkV2Props } from "./components/wordmark-v2.js"
export { IconV2, ICONS_V2, type IconV2Name, type IconV2Props } from "./components/icon-v2.js"
export {
  ErrorBoundary,
  DefaultErrorFallback,
  type ErrorBoundaryProps,
  type ErrorFallbackProps,
  type DefaultErrorFallbackProps,
} from "./components/error-boundary.js"
export {
  ToastProvider,
  useToast,
  ToastAction,
  type ToastOptions,
  type ToastVariant,
  type ToastContextValue,
  type ToastProviderProps,
  type ToastActionProps,
} from "./components/toast.js"

// ---------------------------------------------------------------------------
// Generic primitives
// ---------------------------------------------------------------------------

// Data display
export {
  DataGrid,
  nextSort,
  sortRows,
  type DataGridProps,
  type DataGridColumn,
  type DataGridSort,
  type DataGridLabels,
  type SortDirection,
} from "./components/data-grid.js"
export {
  VirtualListEnhanced,
  computeVisibleRange,
  type VirtualListEnhancedProps,
  type ComputeVisibleRangeOptions,
  type VisibleRange,
} from "./components/virtual-list-enhanced.js"

// Layout
export {
  SplitPane,
  clampSize,
  type SplitPaneProps,
  type SplitPaneDirection,
} from "./components/split-pane.js"
export {
  ResizableGrid,
  resizeColumns,
  buildGridTemplate,
  type ResizableGridProps,
  type ResizableGridColumn,
} from "./components/resizable-grid.js"

// Navigation
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsSectionTitle,
  type TabsProps,
  type TabsListProps,
  type TabsTriggerProps,
  type TabsContentProps,
} from "./components/tabs.js"
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  type AccordionProps,
  type AccordionItemProps,
  type AccordionTriggerProps,
  type AccordionContentProps,
} from "./components/accordion.js"
export {
  Stepper,
  getStepState,
  type StepperProps,
  type StepperStep,
  type StepState,
} from "./components/stepper.js"
export {
  Breadcrumb as Breadcrumbs,
  Breadcrumb,
  type BreadcrumbProps,
  type BreadcrumbItem,
} from "./components/breadcrumb.js"
export { Pagination, buildPageList, type PaginationProps } from "./components/pagination.js"

// Forms / input
export {
  Slider,
  RangeSlider,
  type SliderProps,
  type RangeSliderProps,
} from "./components/slider.js"
export {
  Switch,
  Switch as Toggle,
  type SwitchProps,
  type SwitchProps as ToggleProps,
} from "./components/switch.js"

// Overlay
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipKeybind,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipContentProps,
  type TooltipProviderProps,
  type TooltipKeybindProps,
} from "./components/tooltip.js"
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  type PopoverProps,
  type PopoverTriggerProps,
  type PopoverContentProps,
  type PopoverAnchorProps,
} from "./components/popover.js"

// Feedback / status
export { SpinnerRing, type SpinnerRingProps } from "./components/spinner-ring.js"
export { EmptyState, type EmptyStateProps } from "./components/empty-state.js"
