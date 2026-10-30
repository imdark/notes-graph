import type { FlagInfo } from './types';

// const isNotStableBuild = BUILD_CONFIG.appBuildType !== 'stable';
const isCanaryBuild = BUILD_CONFIG.appBuildType === 'canary';
const isMobile = BUILD_CONFIG.isMobileEdition;
const isIOS = BUILD_CONFIG.isIOS;
const isAndroid = BUILD_CONFIG.isAndroid;

export const NOTESGRAPH_FLAGS = {
  enable_ai: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai.description',
    hide: true,
    configurable: true,
    defaultState: true,
  },
  enable_ai_network_search: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-network-search.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-network-search.description',
    hide: true,
    configurable: false,
    defaultState: true,
  },
  enable_ai_playground: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-model-switch.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-model-switch.description',
    configurable: isCanaryBuild,
    defaultState: isCanaryBuild,
  },
  enable_edgeless_text: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_edgeless_text',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-edgeless-text.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-edgeless-text.description',
    configurable: false,
    defaultState: true,
  },
  enable_color_picker: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_color_picker',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-color-picker.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-color-picker.description',
    configurable: false,
    defaultState: true,
  },
  enable_ai_chat_block: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_ai_chat_block',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-chat-block.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-chat-block.description',
    configurable: false,
    defaultState: true,
  },
  enable_ai_onboarding: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_ai_onboarding',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-onboarding.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-onboarding.description',
    configurable: false,
    defaultState: true,
  },
  enable_mind_map_import: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_mind_map_import',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-mind-map-import.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-mind-map-import.description',
    configurable: false,
    defaultState: true,
  },
  enable_block_meta: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_block_meta',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-block-meta.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-block-meta.description',
    configurable: isCanaryBuild,
    defaultState: true,
  },

  enable_emoji_folder_icon: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-emoji-folder-icon.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-emoji-folder-icon.description',

    feedbackType: 'discord',
    feedbackLink: 'https://notesgraph.com/redirect/discord',
    configurable: false,
    defaultState: true,
  },
  enable_emoji_doc_icon: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-emoji-doc-icon.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-emoji-doc-icon.description',
    feedbackType: 'discord',
    feedbackLink: 'https://notesgraph.com/redirect/discord',
    configurable: false,
    defaultState: true,
  },
  enable_editor_settings: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-editor-settings.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-editor-settings.description',
    configurable: false,
    defaultState: true,
  },
  enable_theme_editor: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-theme-editor.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-theme-editor.description',
    // Reachable on every desktop build (opt-in via experimental features), so
    // the theme presets gallery + custom theme editor are usable on stable too.
    configurable: !isMobile,
    defaultState: isCanaryBuild,
  },
  enable_advanced_block_visibility: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_advanced_block_visibility',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-advanced-block-visibility.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-advanced-block-visibility.description',
    configurable: true,
    defaultState: false,
  },
  enable_mobile_keyboard_toolbar: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_mobile_keyboard_toolbar',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-mobile-keyboard-toolbar.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-mobile-keyboard-toolbar.description',
    configurable: false,
    defaultState: isMobile,
  },
  enable_mobile_linked_doc_menu: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_mobile_linked_doc_menu',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-mobile-linked-doc-menu.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-mobile-linked-doc-menu.description',
    configurable: false,
    defaultState: isMobile,
  },
  enable_mobile_edgeless_editing: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-mobile-edgeless-editing.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-mobile-edgeless-editing.description',
    configurable: isMobile,
    defaultState: false,
  },
  enable_pdf_embed_preview: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-pdf-embed-preview.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-pdf-embed-preview.description',
    configurable: !isMobile,
    defaultState: true,
  },
  enable_editor_rtl: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-editor-rtl.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-editor-rtl.description',
    configurable: isCanaryBuild,
    defaultState: false,
  },
  enable_mobile_ai_button: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName: 'Enable AI Button',
    description: 'Enable AI Button on mobile',
    configurable: isMobile && isIOS,
    defaultState: isMobile && isIOS,
  },
  enable_mermaid_wasm_native_renderer: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName: 'Enable Native Mermaid Renderer',
    description:
      'Use the new Mermaid renderer backend. Web uses WASM, desktop uses native, and mobile always uses native. The native renderer is more than 10x faster, but its styling/aesthetic quality and the types of graphics it supports are not as good as the JS version.',
    configurable: !isIOS && !isAndroid,
    defaultState: isIOS || isAndroid,
  },
  enable_turbo_renderer: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_turbo_renderer',
    displayName: 'Enable Turbo Renderer',
    description: 'Enable experimental edgeless turbo renderer',
    configurable: isCanaryBuild,
    defaultState: false,
  },
  enable_dom_renderer: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_dom_renderer',
    displayName: 'Enable DOM Renderer',
    description: 'Enable DOM renderer for graphics elements',
    configurable: true,
    defaultState: false,
  },
  enable_edgeless_scribbled_style: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_edgeless_scribbled_style',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-edgeless-scribbled-style.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-edgeless-scribbled-style.description',
    configurable: isCanaryBuild,
    defaultState: false,
  },
  enable_table_virtual_scroll: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_table_virtual_scroll',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-table-virtual-scroll.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-table-virtual-scroll.description',
    configurable: isCanaryBuild,
    defaultState: false,
  },
  enable_setting_subpage_animation: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName: 'Enable Setting Subpage Animation',
    description: 'Apply animation for setting subpage open/close',
    configurable: isCanaryBuild,
    defaultState: false,
  },
  enable_adapter_panel: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-adapter-panel.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-adapter-panel.description',
    configurable: isCanaryBuild,
    defaultState: false,
  },
  enable_view_analytics_panel: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName: 'Enable View Analytics Panel',
    description: 'Show the View analytics tab in the right sidebar.',
    configurable: true,
    defaultState: false,
  },
  enable_two_step_journal_confirmation: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName: 'Enable Two Step Journal Confirmation',
    description:
      'When enabled, you must confirm the journal before you can create a new journal.',
    configurable: isCanaryBuild,
    defaultState: isCanaryBuild,
  },
  enable_send_detailed_object_to_ai: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-send-detailed-object.name',
    description:
      'com.notesgraph.settings.workspace.experimental-features.enable-ai-send-detailed-object.description',
    configurable: true,
    defaultState: true,
  },
  enable_battery_save_mode: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName: 'Enable Battery Save Mode (Require Restart)',
    description:
      'Limit indexing and other compute-intensive tasks on this device, may experience longer loading time and latency in search and other features, in exchange for quietness.',
    configurable: true,
    defaultState: isMobile,
  },
  enable_mobile_database_editing: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_mobile_database_editing',
    displayName: 'Enable Mobile Database Editing',
    description: 'Enable mobile database editing',
    configurable: isMobile,
    defaultState: false,
  },
  enable_pdfmake_export: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'blocksuite',
    bsFlag: 'enable_pdfmake_export',
    displayName: 'Enable PDF Export',
    description:
      'Experimental export PDFs support, it may contain the wrong style.',
    configurable: true,
    defaultState: false,
  },
  enable_debug_console: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName: 'Enable Debug Console',
    description:
      'Show an on-screen console to inspect logs, errors, and network requests. Useful for debugging on iOS and Android where browser devtools are unavailable.',
    configurable: isMobile,
    defaultState: false,
  },
  enable_suggest_parent: {
    commit: '90139f5c8c793de8bb232a3889349d1674bb66f8',
    category: 'notesgraph',
    displayName: 'Suggest parent notes',
    description:
      'When a note has no parent, suggest a few likely parent notes to link it under. Also adds a "Set parent…" option to the note menu.',
    configurable: true,
    defaultState: true,
  },
  enable_monitor_run_button: {
    commit: 'dc60a8a1238d18f8c62cf2799e7b38c7f2f3d4a8',
    category: 'notesgraph',
    displayName: 'Run a monitor from its editor',
    description:
      'A Run button in the monitor editor: saves the changes, runs the monitor once and shows what it got.',
    configurable: true,
    defaultState: true,
  },
  enable_deploy_with_automations: {
    commit: 'efc80e3e44f72bbab0cdaf255426f159dbeb8354',
    category: 'notesgraph',
    displayName: 'Deploy with automations',
    description:
      "Deploy from the Deployments page and a run's Deploy tab without a model: wf on the ship agent's device merges the pull requests and runs the cloud deploy as automations. Pull requests that don't merge cleanly still go to Claude Code.",
    configurable: true,
    defaultState: false,
  },
  enable_deploy_repo_branches: {
    commit: '',
    category: 'notesgraph',
    displayName: 'Branches per repo on Deployments',
    description:
      'Set each repo’s base branch (where its pull requests merge) and deploy branch (what prod deploys from) under Repos on the Deployments page. Merges and deploys sent to Claude Code use them, a repo without them is refused rather than guessed as main, and neither branch is ever deleted as a merged branch.',
    configurable: true,
    defaultState: false,
  },
} satisfies { [key in string]: FlagInfo };

// oxlint-disable-next-line no-redeclare
export type NOTESGRAPH_FLAGS = typeof NOTESGRAPH_FLAGS;
