'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Archive,
  ArrowLeft,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FileText,
  Folder,
  FolderPlus,
  History,
  Inbox,
  LayoutGrid,
  Link2,
  List,
  Lock,
  Mic,
  Network,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';

interface DocItem {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  parentId: string | null;
  ancestors: string[];
  body: string;
  keyVersion: number;
  sha256: string;
  sizeBytes: number;
  language: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}

interface DocVersionItem {
  version: number;
  body: string;
  keyVersion: number;
  sha256: string;
  writtenBy: string;
  createdAt: string;
}

interface KnowledgeCollectionItem {
  id: string;
  name: string;
  rootFolderId: string;
}

interface CitationItem {
  docId: string;
  documentName: string;
  paragraphOrdinal: number;
  excerpt: string;
  score: number;
}

interface MemoryAnswerItem {
  question: string;
  answerMarkdown: string;
  notFound: boolean;
  citations: CitationItem[];
  model: string;
  latencyMs: number;
}

interface ComponentNodeItem {
  id: string;
  type: string;
  label?: string;
  fieldKey?: string;
  statusField?: string;
  dateField?: string;
  metricOperation?: 'count' | 'sum' | 'avg';
  markdown?: string;
  collectionIds?: string[];
  childrenIds?: string[];
}

interface AppDefItem {
  schemaVersion: number;
  name: string;
  description: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
  }>;
  components: ComponentNodeItem[];
  rootPageIds: string[];
  statusTransitions: Array<{
    fromStatus: string;
    toStatus: string;
    allowedRoles: string[];
    approverUids: string[];
  }>;
}

interface AppItem {
  id: string;
  draftDefinition: AppDefItem;
  version: number;
  publishedSnapshotVersion: number | null;
  status: 'draft' | 'published' | 'archived';
  updatedAt: string;
}

interface AppRecordItem {
  id: string;
  appId: string;
  body: string;
  fields: Record<string, string | number | null>;
  notesMarkdown: string;
  version: number;
  updatedAt: string;
}

interface AuditEventItem {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  appId: string | null;
  appVersion: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface BuilderDiffItem {
  appId: string;
  baseVersion: number;
  summary: string;
  proposedDefinition: AppDefItem;
  addedComponentIds: string[];
  modifiedComponentIds: string[];
  removedComponentIds: string[];
}

type VaultViewMode = 'grid' | 'list' | 'calendar' | 'graph' | 'editor' | 'inbox' | 'code';

const DEMO_TENANTS = [
  {
    uid: 'berezovsky360',
    orgId: 'org-berezovsky',
    role: 'owner' as const,
    handle: '@berezovsky360',
  },
  {
    uid: 'beta_admin',
    orgId: 'org-beta',
    role: 'owner' as const,
    handle: '@beta_admin',
  },
];

const CALENDAR_MONTHS_2026 = [
  { name: 'January', days: 31, startOffset: 3 },
  { name: 'February', days: 28, startOffset: 6 },
  { name: 'March', days: 31, startOffset: 6 },
  { name: 'April', days: 30, startOffset: 2 },
  { name: 'May', days: 31, startOffset: 4 },
  { name: 'June', days: 30, startOffset: 0 },
];

export default function LowWorkspacePage() {
  const [activeTenantIdx, setActiveTenantIdx] = useState(0);
  const currentTenant = DEMO_TENANTS[activeTenantIdx] ?? DEMO_TENANTS[0]!;

  const [viewMode, setViewMode] = useState<VaultViewMode>('grid');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);

  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [rawCiphertexts, setRawCiphertexts] = useState<Record<string, string>>({});
  const [collections, setCollections] = useState<KnowledgeCollectionItem[]>([]);
  const [chunkCount, setChunkCount] = useState(0);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [appRecordsMap, setAppRecordsMap] = useState<Record<string, AppRecordItem[]>>({});
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);

  const [openTabIds, setOpenTabIds] = useState<string[]>(['2026-09-07-19-45-33']);
  const [activeDocId, setActiveDocId] = useState<string | null>('2026-09-07-19-45-33');
  const [editorBody, setEditorBody] = useState('');
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [showInspector, setShowInspector] = useState(false);
  const [docVersions, setDocVersions] = useState<DocVersionItem[]>([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const [vaultsExpanded, setVaultsExpanded] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'folder-test': true,
  });
  const [binExpanded, setBinExpanded] = useState(true);
  const [sharedExpanded, setSharedExpanded] = useState(false);

  const [graphZoom, setGraphZoom] = useState(100);

  // Memory Q&A
  const [memoryQuestion, setMemoryQuestion] = useState('');
  const [memoryAnswer, setMemoryAnswer] = useState<MemoryAnswerItem | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

  // App Builder & UX/UI Studio
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [codeTab, setCodeTab] = useState<'app' | 'marketplace' | 'builder' | 'audit'>('app');
  const [builderInstruction, setBuilderInstruction] = useState('');
  const [proposedDiff, setProposedDiff] = useState<BuilderDiffItem | null>(null);
  const [newDealTitle, setNewDealTitle] = useState('');
  const [newDealAmount, setNewDealAmount] = useState('40000');
  const [uiTheme, setUiTheme] = useState<'obsidian' | 'cyber' | 'glass' | 'light'>('obsidian');
  const [uiMotion, setUiMotion] = useState<'spring' | 'glow'>('spring');
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile' | 'guest'>('desktop');
  const [appChatInput, setAppChatInput] = useState('');
  const [appChatReply, setAppChatReply] = useState<string | null>(null);

  // Modals & Google Gemini / Vertex AI Model Config
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [nnProvider, setNnProvider] = useState<'gemini' | 'vertex'>('gemini');
  const [nnModel, setNnModel] = useState('gemini-2.5-flash');
  const [nnApiKey, setNnApiKey] = useState('');
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [micModalOpen, setMicModalOpen] = useState(false);
  const [voiceTranscriptInput, setVoiceTranscriptInput] = useState('');
  const [newFileModalOpen, setNewFileModalOpen] = useState(false);
  const [newItemKind, setNewItemKind] = useState<'file' | 'folder'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [newItemParentId, setNewItemParentId] = useState<string>('');
  const [newItemBody, setNewItemBody] = useState('');

  const [statusToast, setStatusToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 2800);
  }, []);

  const apiHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'x-low-uid': currentTenant.uid,
      'x-low-org-id': currentTenant.orgId,
      'x-low-role': currentTenant.role,
    }),
    [currentTenant]
  );

  const refreshWorkspace = useCallback(async () => {
    const res = await fetch('/api/low', { headers: apiHeaders });
    if (!res.ok) return;
    const data = await res.json();
    setDocuments(data.documents ?? []);
    setRawCiphertexts(data.rawCiphertexts ?? {});
    setCollections(data.collections ?? []);
    setChunkCount(data.chunkCount ?? 0);
    setApps(data.apps ?? []);
    setAppRecordsMap(data.appRecordsMap ?? {});
    setAuditEvents(data.auditEvents ?? []);
  }, [apiHeaders]);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const liveDocs = useMemo(
    () => documents.filter((d) => d.deletedAt === null),
    [documents]
  );
  const archivedDocs = useMemo(
    () => documents.filter((d) => d.deletedAt !== null),
    [documents]
  );
  const liveFiles = useMemo(
    () =>
      liveDocs.filter(
        (d) =>
          d.kind === 'file' &&
          (searchQuery.trim() === '' ||
            d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            d.body.toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    [liveDocs, searchQuery]
  );
  const liveFolders = useMemo(
    () => liveDocs.filter((d) => d.kind === 'folder'),
    [liveDocs]
  );

  const folderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of liveFolders) {
      map.set(f.id, f.name);
    }
    return map;
  }, [liveFolders]);

  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId) ?? liveFiles[0] ?? null,
    [documents, activeDocId, liveFiles]
  );

  useEffect(() => {
    if (activeDoc && activeDoc.kind === 'file') {
      setEditorBody(activeDoc.body);
    }
  }, [activeDoc?.id, activeDoc?.version]);

  const openDocumentInEditor = useCallback((doc: DocItem) => {
    if (doc.kind === 'folder') {
      setExpandedFolders((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }));
      return;
    }
    setActiveDocId(doc.id);
    setEditorBody(doc.body);
    setOpenTabIds((prev) => (prev.includes(doc.id) ? prev : [...prev, doc.id]));
    setViewMode('editor');
  }, []);

  const handleSaveActiveDocument = async () => {
    if (!activeDoc || activeDoc.kind !== 'file') return;
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'update_document',
        data: {
          docId: activeDoc.id,
          expectedVersion: activeDoc.version,
          body: editorBody,
        },
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      notify(payload.error);
      return;
    }
    await refreshWorkspace();
    notify(`Saved v${payload.document.version}`);
  };

  const handleLoadVersions = async (docId: string) => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'list_versions',
        data: { docId },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setDocVersions(data.versions ?? []);
      setShowVersionHistory((v) => !v);
    }
  };

  const handleArchiveDocument = async (doc: DocItem) => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'archive_document',
        data: {
          docId: doc.id,
          expectedVersion: doc.version,
        },
      }),
    });
    if (res.ok) {
      await refreshWorkspace();
      notify('Moved to Bin');
      if (viewMode === 'editor' && activeDoc?.id === doc.id) {
        setViewMode('list');
      }
    }
  };

  const handleRestoreDocument = async (doc: DocItem) => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'restore_document',
        data: {
          docId: doc.id,
          expectedVersion: doc.version,
        },
      }),
    });
    if (res.ok) {
      await refreshWorkspace();
      notify('Restored');
    }
  };

  const handleCreateItem = async () => {
    if (!newItemName.trim()) return;
    const formattedName =
      newItemKind === 'file' && !newItemName.trim().endsWith('.md')
        ? `${newItemName.trim()}.md`
        : newItemName.trim();

    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'create_document',
        data: {
          kind: newItemKind,
          name: formattedName,
          parentId: newItemParentId || null,
          body: newItemKind === 'file' ? newItemBody : '',
          language: 'en',
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setNewFileModalOpen(false);
      setNewItemName('');
      setNewItemBody('');
      await refreshWorkspace();
      if (data.document.kind === 'file') {
        openDocumentInEditor(data.document);
      }
    }
  };

  const handleCaptureVoice = async () => {
    const nowName = `${new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')
      .replace(/:/g, '-')}.wav`;
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'capture_audio',
        data: {
          fileName: nowName,
          transcriptText: voiceTranscriptInput || 'Voice note',
          targetFolderId: liveFolders[0]?.id ?? null,
          language: 'en',
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setMicModalOpen(false);
      setVoiceTranscriptInput('');
      await refreshWorkspace();
      openDocumentInEditor(data.document);
    }
  };

  const handleSaveNeuralConfig = async (
    nextProvider = nnProvider,
    nextModel = nnModel,
    nextKey = nnApiKey
  ) => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'configure_models',
        data: {
          provider: nextProvider,
          modelId: nextModel,
          apiKey: nextKey,
        },
      }),
    });
    if (res.ok) {
      setModelModalOpen(false);
      notify(`Active Model: ${nextModel}`);
    }
  };

  const handleAskMemory = async (customQuestion?: string) => {
    const q = customQuestion ?? memoryQuestion;
    if (!q.trim()) return;
    setMemoryLoading(true);
    try {
      const res = await fetch('/api/low', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({
          operation: 'ask_memory',
          data: {
            question: q,
            collectionIds: collections.map((c) => c.id),
            provider: nnProvider,
            modelId: nnModel,
            apiKey: nnApiKey,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMemoryAnswer(data.answer);
      }
    } finally {
      setMemoryLoading(false);
    }
  };

  const handleRebuildDerived = async () => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({ operation: 'rebuild_derived' }),
    });
    const data = await res.json();
    if (res.ok) {
      await refreshWorkspace();
      notify(`Rebuilt ${data.rebuildStats.rebuiltChunks} chunks`);
    }
  };

  const handleCreateAppFromPrompt = async (promptText: string) => {
    const prompt = promptText.trim();
    if (!prompt) return;
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'create_app_from_prompt',
        data: { prompt },
      }),
    });
    const data = await res.json();
    if (res.ok && data.app) {
      await refreshWorkspace();
      setSelectedAppId(data.app.id);
      setProposedDiff(null);
      setBuilderInstruction('');
      notify(`Created ${data.app.draftDefinition.name}`);
    }
  };

  const handleProposeDiff = async (appId: string, overrideInstruction?: string) => {
    const instruction = (overrideInstruction ?? builderInstruction).trim();
    if (!instruction) return;
    if (overrideInstruction) {
      setBuilderInstruction(overrideInstruction);
    }
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'propose_builder_diff',
        data: {
          appId,
          instruction,
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setProposedDiff(data.diff);
    }
  };

  const handleApplyDiff = async () => {
    if (!proposedDiff) return;
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'apply_builder_diff',
        data: {
          appId: proposedDiff.appId,
          expectedVersion: proposedDiff.baseVersion,
          definition: proposedDiff.proposedDefinition,
        },
      }),
    });
    if (res.ok) {
      setProposedDiff(null);
      setBuilderInstruction('');
      await refreshWorkspace();
      notify('Applied diff');
    }
  };

  const handlePublishApp = async (app: AppItem) => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'publish_app',
        data: {
          appId: app.id,
          expectedVersion: app.version,
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      await refreshWorkspace();
      notify(`Published v${data.snapshot.version}`);
    }
  };

  const activeApp =
    apps.find((a) => a.id === selectedAppId) ?? apps[0] ?? null;
  const activeAppRecords = activeApp ? (appRecordsMap[activeApp.id] ?? []) : [];

  const handleCreateDealRecord = async (appId: string) => {
    if (!newDealTitle.trim()) return;
    const statusField = activeApp?.draftDefinition.fields.find(
      (f) => f.key === 'status'
    );
    const initialStatus = statusField?.options?.[0] ?? 'Draft';
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'create_app_record',
        data: {
          appId,
          fields: {
            title: newDealTitle.trim(),
            status: initialStatus,
            amount: Number(newDealAmount) || 0,
            dueDate: '2026-09-18',
          },
          notesMarkdown: '',
        },
      }),
    });
    if (res.ok) {
      setNewDealTitle('');
      await refreshWorkspace();
    }
  };

  const handleTransitionRecord = async (
    appId: string,
    rec: AppRecordItem,
    toStatus: string
  ) => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'transition_record_status',
        data: {
          appId,
          recId: rec.id,
          expectedVersion: rec.version,
          statusField: 'status',
          toStatus,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error);
      return;
    }
    await refreshWorkspace();
  };

  const handleRunAutomationJob = async (appId: string) => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'enqueue_and_run_automation',
        data: {
          appId,
          triggerType: 'schedule',
          payload: { runDate: new Date().toISOString() },
        },
      }),
    });
    if (res.ok) {
      await refreshWorkspace();
      notify('Job completed');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#0b0b0c',
        color: '#e5e5e7',
        userSelect: 'none',
      }}
    >
      {/* =================================================================== */}
      {/* MINIMALIST TOP BAR (Matches Screenshots 1-5)                        */}
      {/* =================================================================== */}
      <header
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          gap: 10,
          backgroundColor: '#0b0b0c',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          {/* Blue LOW Icon */}
          <button
            onClick={() => setViewMode('grid')}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: '#0088ff',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 20,
                height: 16,
                backgroundColor: '#ffffff',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0088ff',
                fontWeight: 800,
                fontSize: 10,
              }}
            >
              ◡
            </div>
          </button>

          {/* Minimal Tab Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#131316',
              border: '1px solid #1c1c20',
              borderRadius: 10,
              height: 36,
              padding: '0 8px',
              flex: 1,
              gap: 6,
              overflow: 'hidden',
            }}
          >
            {openTabIds.map((tabId) => {
              const doc = documents.find((d) => d.id === tabId);
              if (!doc) return null;
              const isCurrent = viewMode === 'editor' && activeDoc?.id === doc.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => openDocumentInEditor(doc)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 7,
                    fontSize: 12,
                    cursor: 'pointer',
                    backgroundColor: isCurrent ? '#1d1d22' : 'transparent',
                    color: isCurrent ? '#f4f4f6' : '#8e8e93',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: '#636366' }}>#</span>
                  <span>
                    {doc.name.length > 18 ? `${doc.name.slice(0, 15)}....` : doc.name}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenTabIds((prev) => prev.filter((id) => id !== doc.id));
                    }}
                    style={{
                      marginLeft: 2,
                      color: '#636366',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={12} />
                  </span>
                </div>
              );
            })}

            <button
              onClick={() => {
                setNewItemKind('file');
                setNewFileModalOpen(true);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#8e8e93',
                cursor: 'pointer',
                padding: '4px 6px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Plus size={14} />
            </button>

            <div style={{ flex: 1 }} />

            {searchOpen && (
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={() => {
                  if (!searchQuery) setSearchOpen(false);
                }}
                placeholder="Search..."
                style={{
                  background: '#1c1c21',
                  border: 'none',
                  borderRadius: 6,
                  padding: '3px 8px',
                  outline: 'none',
                  fontSize: 12,
                  width: 140,
                  color: '#e5e5e7',
                }}
              />
            )}

            <button
              onClick={() => setModelModalOpen(true)}
              title="Select Neural Network & API Key"
              style={{
                backgroundColor: '#1c1c21',
                border: '1px solid #2c2c32',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 11,
                color: '#60a5fa',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                whiteSpace: 'nowrap',
              }}
            >
              <span>⚡ {nnModel}</span>
            </button>

            <button
              onClick={() => setSearchOpen((v) => !v)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                color: '#0088ff',
              }}
            >
              <Search size={14} />
            </button>

            <button
              onClick={() => setSidebarOpen((v) => !v)}
              style={{
                background: '#1c1c21',
                border: '1px solid #2c2c32',
                borderRadius: 6,
                width: 26,
                height: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#a1a1aa',
              }}
            >
              <PanelRight size={14} />
            </button>
          </div>
        </div>

        {/* Right: User Menu (@berezovsky360) */}
        <div style={{ position: 'relative', width: 268, flexShrink: 0 }}>
          <button
            onClick={() => setTenantMenuOpen((o) => !o)}
            style={{
              width: '100%',
              height: 36,
              backgroundColor: '#131316',
              border: '1px solid #1c1c20',
              borderRadius: 10,
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <User size={14} color="#a1a1aa" />
              <span>{currentTenant.handle}</span>
            </div>
            <ChevronDown size={13} color="#71717a" />
          </button>

          {tenantMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 42,
                right: 0,
                width: 268,
                backgroundColor: '#16161a',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: 6,
                zIndex: 50,
                boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
              }}
            >
              {DEMO_TENANTS.map((t, idx) => (
                <button
                  key={t.orgId}
                  onClick={() => {
                    setActiveTenantIdx(idx);
                    setTenantMenuOpen(false);
                    setMemoryAnswer(null);
                    setViewMode('grid');
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 10px',
                    borderRadius: 7,
                    border: 'none',
                    backgroundColor:
                      idx === activeTenantIdx ? '#222228' : 'transparent',
                    color: '#e5e5e7',
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>{t.handle}</span>
                  <span style={{ color: '#71717a', fontSize: 11 }}>{t.orgId}</span>
                </button>
              ))}
              <div
                style={{
                  borderTop: '1px solid #27272a',
                  marginTop: 4,
                  paddingTop: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <button
                  onClick={() => {
                    setTenantMenuOpen(false);
                    setMcpModalOpen(true);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    borderRadius: 7,
                    border: 'none',
                    backgroundColor: 'transparent',
                    fontSize: 12,
                    color: '#60a5fa',
                    cursor: 'pointer',
                  }}
                >
                  <Link2 size={13} />
                  <span>Connect Antigravity</span>
                </button>
                <a
                  href={`/api/export?orgId=${encodeURIComponent(
                    currentTenant.orgId
                  )}&uid=${encodeURIComponent(currentTenant.uid)}&role=${encodeURIComponent(
                    currentTenant.role
                  )}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    borderRadius: 7,
                    fontSize: 12,
                    color: '#a1a1aa',
                    textDecoration: 'none',
                  }}
                >
                  <Download size={13} />
                  <span>Export .zip</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* =================================================================== */}
      {/* MAIN BODY                                                           */}
      {/* =================================================================== */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Minimal Vault Header */}
          {viewMode !== 'editor' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 18px 8px 18px',
                borderBottom: '1px solid #141417',
                flexShrink: 0,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f6' }}>
                  {viewMode === 'inbox'
                    ? 'Inbox'
                    : viewMode === 'code'
                    ? 'Code'
                    : 'Vault'}
                </div>
                <div style={{ fontSize: 11, color: '#71717a', marginTop: 1 }}>
                  Everything you have kept
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => setViewMode('grid')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'grid' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'list' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <List size={15} />
                </button>
                <button
                  onClick={() => setViewMode('calendar')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'calendar' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <CalendarIcon size={15} />
                </button>
                <button
                  onClick={() => setViewMode('graph')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'graph' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Network size={15} />
                </button>

                <button
                  onClick={() => setViewMode('code')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'code' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                  }}
                >
                  <Settings size={13} />
                  <span>CUSTOMIZE</span>
                </button>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 1: MINIMAL BENTO GRID (Matches Screenshot 1)               */}
          {/* =============================================================== */}
          {viewMode === 'grid' && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                gap: 20,
                padding: '14px 18px 24px 18px',
                minHeight: 0,
              }}
            >
              {/* Left 2x2 Bento Container */}
              <div
                style={{
                  flex: '0 0 46%',
                  backgroundColor: '#121214',
                  borderRadius: 22,
                  padding: 14,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gridTemplateRows: '1fr 1fr',
                  gap: 14,
                }}
              >
                {[0, 1, 2, 3].map((slotIdx) => {
                  const doc = liveFiles[slotIdx];
                  const isSelected = doc && activeDoc?.id === doc.id;
                  return (
                    <div
                      key={slotIdx}
                      onClick={() => doc && openDocumentInEditor(doc)}
                      title={doc?.name}
                      style={{
                        backgroundColor: isSelected ? '#cfd0d3' : '#8c8d91',
                        borderRadius: 16,
                        cursor: doc ? 'pointer' : 'default',
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        color: '#18181b',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {doc && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.6 }}>v{doc.version}</span>
                            <Lock size={11} style={{ opacity: 0.55 }} />
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {doc.name}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Right Large Minimalist Canvas */}
              <div
                onClick={() => activeDoc && openDocumentInEditor(activeDoc)}
                title={activeDoc?.name}
                style={{
                  flex: 1,
                  backgroundColor: '#e4e4e7',
                  borderRadius: 22,
                  cursor: activeDoc ? 'pointer' : 'default',
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  color: '#18181b',
                }}
              >
                {activeDoc && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{activeDoc.name}</span>
                      <span style={{ fontSize: 11, opacity: 0.6 }}>AES-256-GCM · v{activeDoc.version}</span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.75,
                        lineHeight: 1.55,
                        maxHeight: '70%',
                        overflow: 'hidden',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {activeDoc.body.slice(0, 420)}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#0088ff' }}>
                      Open in Editor →
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 2: MARKDOWN EDITOR (Matches Screenshot 2)                  */}
          {/* =============================================================== */}
          {viewMode === 'editor' && activeDoc && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 18px',
                  borderBottom: '1px solid #18181b',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => setViewMode('grid')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#8e8e93',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6' }}>
                      {activeDoc.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#71717a' }}>
                      Vault / {activeDoc.name}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <button
                    onClick={() => {
                      const blob = new Blob([editorBody], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = activeDoc.name;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0088ff',
                      cursor: 'pointer',
                    }}
                  >
                    <Download size={15} />
                  </button>

                  <button
                    onClick={() => {
                      void navigator.clipboard?.writeText(editorBody);
                      notify('Copied');
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#8e8e93',
                      cursor: 'pointer',
                    }}
                  >
                    <Copy size={15} />
                  </button>

                  <button
                    onClick={() => void handleLoadVersions(activeDoc.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: showVersionHistory ? '#0088ff' : '#8e8e93',
                      cursor: 'pointer',
                    }}
                  >
                    <History size={15} />
                  </button>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      color: '#8e8e93',
                      fontSize: 12,
                    }}
                  >
                    <button
                      onClick={() => setEditorFontSize((s) => Math.max(11, s - 1))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#8e8e93',
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                    >
                      A
                    </button>
                    <span style={{ fontSize: 11 }}>{editorFontSize}</span>
                    <button
                      onClick={() => setEditorFontSize((s) => Math.min(22, s + 1))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#8e8e93',
                        cursor: 'pointer',
                        fontSize: 14,
                      }}
                    >
                      A
                    </button>
                  </div>

                  <button
                    onClick={() => setShowInspector((v) => !v)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0088ff',
                      cursor: 'pointer',
                    }}
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                </div>
              </div>

              {/* Minimal Formatting Toolbar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 18px',
                  borderBottom: '1px solid #18181b',
                  fontSize: 12,
                  color: '#a1a1aa',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    Text <ChevronDown size={12} />
                  </span>
                  <button
                    onClick={() => setEditorBody((b) => `${b} **bold**`)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontWeight: 700,
                      cursor: 'pointer',
                      color: '#a1a1aa',
                    }}
                  >
                    B
                  </button>
                  <button
                    onClick={() => setEditorBody((b) => `${b} *italic*`)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontStyle: 'italic',
                      cursor: 'pointer',
                      color: '#a1a1aa',
                    }}
                  >
                    I
                  </button>
                  <button
                    onClick={() => setEditorBody((b) => `${b} ~~strike~~`)}
                    style={{
                      background: 'none',
                      border: 'none',
                      textDecoration: 'line-through',
                      cursor: 'pointer',
                      color: '#a1a1aa',
                    }}
                  >
                    S
                  </button>
                  <button
                    onClick={() => setEditorBody((b) => `${b} \`code\``)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#a1a1aa',
                    }}
                  >
                    {'<>'}
                  </button>
                  <button
                    onClick={() => setEditorBody((b) => `${b} [link](https://)`)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#a1a1aa',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Link2 size={13} />
                  </button>
                </div>

                {editorBody !== activeDoc.body && (
                  <button
                    onClick={() => void handleSaveActiveDocument()}
                    style={{
                      backgroundColor: '#0088ff',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '3px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Save
                  </button>
                )}
              </div>

              {showInspector && (
                <div
                  style={{
                    backgroundColor: '#121216',
                    borderBottom: '1px solid #1f1f24',
                    padding: '8px 18px',
                    fontSize: 11,
                    color: '#a1a1aa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      overflow: 'hidden',
                    }}
                  >
                    <Lock size={12} color="#0088ff" />
                    <span>v{activeDoc.version}</span>
                    <span>AAD: {currentTenant.orgId}/{activeDoc.id}</span>
                    <span
                      style={{
                        color: '#52525b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 340,
                      }}
                    >
                      {rawCiphertexts[activeDoc.id]}
                    </span>
                  </div>
                  <button
                    onClick={() => void handleArchiveDocument(activeDoc)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#f87171',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      flexShrink: 0,
                    }}
                  >
                    <Archive size={12} />
                    <span>Archive</span>
                  </button>
                </div>
              )}

              {showVersionHistory && (
                <div
                  style={{
                    backgroundColor: '#121216',
                    borderBottom: '1px solid #1f1f24',
                    padding: '8px 18px',
                    display: 'flex',
                    gap: 8,
                    overflowX: 'auto',
                  }}
                >
                  {docVersions.map((ver) => (
                    <button
                      key={ver.version}
                      onClick={() => setEditorBody(ver.body)}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: '#1c1c21',
                        border: '1px solid #2c2c32',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                    >
                      v{ver.version}
                    </button>
                  ))}
                </div>
              )}

              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  padding: '22px 24px',
                  overflow: 'auto',
                  gap: 20,
                }}
              >
                <div
                  style={{
                    color: '#52525b',
                    fontSize: editorFontSize,
                    lineHeight: 1.65,
                    textAlign: 'right',
                    userSelect: 'none',
                    minWidth: 24,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {editorBody.split('\n').map((_, idx) => (
                    <div key={idx}>{idx + 1}</div>
                  ))}
                </div>

                <textarea
                  value={editorBody}
                  onChange={(e) => setEditorBody(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                      e.preventDefault();
                      void handleSaveActiveDocument();
                    }
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    color: '#f4f4f6',
                    fontSize: editorFontSize,
                    lineHeight: 1.65,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                />
              </div>

              <div
                style={{
                  height: 28,
                  padding: '0 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: '#71717a',
                }}
              >
                <span>Markdown</span>
                <span>
                  {editorBody.split('\n').length} line
                  {editorBody.split('\n').length === 1 ? '' : 's'} · Saved locally
                </span>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 3: MINIMAL LIST VIEW (Matches Screenshot 3)                */}
          {/* =============================================================== */}
          {viewMode === 'list' && (
            <div style={{ flex: 1, padding: '14px 18px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {liveFiles.map((file) => {
                  const parentLabel = file.parentId
                    ? folderNameById.get(file.parentId) ?? 'Vault'
                    : 'Vault';
                  return (
                    <div
                      key={file.id}
                      onClick={() => openDocumentInEditor(file)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '4px 4px',
                        cursor: 'pointer',
                      }}
                    >
                      <FileText size={15} color="#a1a1aa" />
                      <span style={{ fontSize: 13, color: '#e5e5e7' }}>
                        {file.name}
                      </span>
                      <span style={{ fontSize: 12, color: '#71717a' }}>
                        {parentLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 4: CALENDAR VIEW (Matches Screenshot 4)                    */}
          {/* =============================================================== */}
          {viewMode === 'calendar' && (
            <div style={{ flex: 1, padding: '14px 24px', overflowY: 'auto' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  marginBottom: 18,
                }}
              >
                <span>2026</span>
                <ChevronDown size={13} color="#71717a" />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px repeat(6, 1fr)',
                  gap: 16,
                  paddingBottom: 24,
                  borderBottom: '1px solid #18181b',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    paddingTop: 26,
                    fontSize: 11,
                    color: '#71717a',
                  }}
                >
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                    <div key={d} style={{ height: 24, display: 'flex', alignItems: 'center' }}>
                      {d}
                    </div>
                  ))}
                </div>

                {CALENDAR_MONTHS_2026.map((month) => {
                  const cols: Array<Array<number | null>> = [[], [], [], [], []];
                  for (let d = 1; d <= month.days; d++) {
                    const pos = month.startOffset + (d - 1);
                    const colIdx = Math.floor(pos / 7);
                    const rowIdx = pos % 7;
                    if (!cols[colIdx]) cols[colIdx] = [];
                    cols[colIdx]![rowIdx] = d;
                  }
                  return (
                    <div key={month.name}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          marginBottom: 10,
                          color: '#e5e5e7',
                        }}
                      >
                        {month.name}
                      </div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {cols.map((col, cIdx) => (
                          <div
                            key={cIdx}
                            style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
                          >
                            {[0, 1, 2, 3, 4, 5, 6].map((rIdx) => {
                              const dayNum = col[rIdx];
                              return (
                                <div
                                  key={rIdx}
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 6,
                                    backgroundColor: dayNum ? '#1f1f23' : 'transparent',
                                    color: '#9ca3af',
                                    fontSize: 10,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  {dayNum ?? ''}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 10,
                    }}
                  >
                    <span
                      style={{
                        border: '1px solid #52525b',
                        borderRadius: 4,
                        padding: '1px 5px',
                        fontSize: 10,
                      }}
                    >
                      7
                    </span>
                    <span>7 September</span>
                    <span style={{ color: '#71717a', fontWeight: 400 }}>4</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {liveFiles
                      .filter((f) => !f.name.startsWith('2026-09-02'))
                      .map((file) => (
                        <div
                          key={file.id}
                          onClick={() => openDocumentInEditor(file)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '4px 6px',
                            cursor: 'pointer',
                            fontSize: 13,
                          }}
                        >
                          <FileText size={14} color="#a1a1aa" />
                          <span>{file.name}</span>
                          <span style={{ color: '#71717a', fontSize: 12 }}>
                            {file.parentId
                              ? folderNameById.get(file.parentId) ?? 'Vault'
                              : 'Vault'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 10,
                    }}
                  >
                    <span
                      style={{
                        border: '1px solid #52525b',
                        borderRadius: 4,
                        padding: '1px 5px',
                        fontSize: 10,
                      }}
                    >
                      2
                    </span>
                    <span>2 September</span>
                    <span style={{ color: '#71717a', fontWeight: 400 }}>1</span>
                  </div>
                  {liveFiles
                    .filter((f) => f.name.startsWith('2026-09-02'))
                    .map((file) => (
                      <div
                        key={file.id}
                        onClick={() => openDocumentInEditor(file)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '4px 6px',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        <FileText size={14} color="#a1a1aa" />
                        <span>{file.name}</span>
                        <span style={{ color: '#71717a', fontSize: 12 }}>test</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 5: KNOWLEDGE GRAPH VIEW (Matches Screenshot 5)             */}
          {/* =============================================================== */}
          {viewMode === 'graph' && (
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 900 560"
                style={{
                  transform: `scale(${graphZoom / 100})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease',
                }}
              >
                <line x1={450} y1={310} x2={450} y2={180} stroke="#3f3f46" strokeWidth={1} />
                <line x1={450} y1={180} x2={450} y2={140} stroke="#3f3f46" strokeWidth={1} />
                <line x1={450} y1={180} x2={155} y2={310} stroke="#3f3f46" strokeWidth={1} />
                <line x1={450} y1={180} x2={745} y2={310} stroke="#3f3f46" strokeWidth={1} />
                <line x1={450} y1={310} x2={450} y2={445} stroke="#3f3f46" strokeWidth={1} />
                <line x1={450} y1={445} x2={450} y2={485} stroke="#3f3f46" strokeWidth={1} />

                <circle cx={450} cy={310} r={9} fill="#d4d4d8" />
                <text
                  x={450}
                  y={338}
                  textAnchor="middle"
                  fill="#e5e5e7"
                  fontSize={12}
                  fontWeight={600}
                >
                  Vault
                </text>

                <circle cx={450} cy={180} r={4.5} fill="#71717a" />
                <text x={462} y={184} fill="#a1a1aa" fontSize={11}>
                  test
                </text>

                {[
                  { doc: liveFiles[0], fallback: '2026-09-02 12-12-16.md', cx: 450, cy: 140 },
                  { doc: liveFiles[3], fallback: '2026-09-07 19-45-14.md', cx: 155, cy: 310 },
                  { doc: liveFiles[1], fallback: '2026-09-07 19-45-11.md', cx: 745, cy: 310 },
                  { doc: liveFiles[4], fallback: '2026-09-07 19-45-33.md', cx: 450, cy: 445 },
                  { doc: liveFiles[2], fallback: '2026-09-07 19-45-13.md', cx: 450, cy: 485 },
                ].map((node, idx) => (
                  <g
                    key={idx}
                    onClick={() => node.doc && openDocumentInEditor(node.doc)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle cx={node.cx} cy={node.cy} r={4.5} fill="#71717a" />
                    <text x={node.cx + 12} y={node.cy + 4} fill="#a1a1aa" fontSize={11}>
                      {node.doc?.name ?? node.fallback}
                    </text>
                  </g>
                ))}
              </svg>

              <div
                style={{
                  position: 'absolute',
                  left: 18,
                  bottom: 18,
                  backgroundColor: '#131316',
                  border: '1px solid #222226',
                  borderRadius: 10,
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  fontSize: 11,
                  color: '#a1a1aa',
                }}
              >
                <button
                  onClick={() => setGraphZoom((z) => Math.max(60, z - 10))}
                  style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer' }}
                >
                  -
                </button>
                <span>{graphZoom}%</span>
                <button
                  onClick={() => setGraphZoom((z) => Math.min(160, z + 10))}
                  style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer' }}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 6: MINIMALIST INBOX (Memory Q&A)                           */}
          {/* =============================================================== */}
          {viewMode === 'inbox' && (
            <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto', maxWidth: 760 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={memoryQuestion}
                  onChange={(e) => setMemoryQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAskMemory();
                  }}
                  placeholder="Ask Vault memory..."
                  style={{
                    flex: 1,
                    backgroundColor: '#131316',
                    border: '1px solid #222226',
                    borderRadius: 10,
                    padding: '10px 14px',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => void handleAskMemory()}
                  disabled={memoryLoading}
                  style={{
                    backgroundColor: '#0088ff',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '0 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Send size={13} />
                </button>
                <button
                  onClick={() => void handleRebuildDerived()}
                  title={`Rebuild index (${chunkCount} chunks)`}
                  style={{
                    backgroundColor: '#131316',
                    border: '1px solid #222226',
                    borderRadius: 10,
                    padding: '0 12px',
                    color: '#8e8e93',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {[
                  'How quickly must production incidents be escalated?',
                  'What threshold requires @berezovsky360 approval?',
                  'What is the Tokyo office lunch menu?',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setMemoryQuestion(q);
                      void handleAskMemory(q);
                    }}
                    style={{
                      backgroundColor: '#131316',
                      border: '1px solid #1f1f24',
                      borderRadius: 6,
                      padding: '4px 9px',
                      fontSize: 11,
                      color: '#8e8e93',
                      cursor: 'pointer',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>

              {memoryAnswer && (
                <div
                  style={{
                    marginTop: 18,
                    padding: 16,
                    borderRadius: 12,
                    backgroundColor: '#131316',
                    border: '1px solid #222226',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  <ReactMarkdown>{memoryAnswer.answerMarkdown}</ReactMarkdown>

                  {memoryAnswer.citations.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                      {memoryAnswer.citations.map((c, idx) => (
                        <span
                          key={idx}
                          onClick={() => {
                            const target = documents.find((d) => d.id === c.docId);
                            if (target) openDocumentInEditor(target);
                          }}
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            borderRadius: 6,
                            backgroundColor: '#1c1c21',
                            color: '#60a5fa',
                            cursor: 'pointer',
                          }}
                        >
                          {c.documentName} §{c.paragraphOrdinal}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 7: MINIMALIST CODE / APP BUILDER STUDIO                    */}
          {/* =============================================================== */}
          {viewMode === 'code' && activeApp && (() => {
            const previewDef =
              proposedDiff && proposedDiff.appId === activeApp.id
                ? proposedDiff.proposedDefinition
                : activeApp.draftDefinition;
            const statusFieldDef = previewDef.fields.find((f) => f.key === 'status');
            const statusStages =
              statusFieldDef?.options && statusFieldDef.options.length > 0
                ? statusFieldDef.options
                : ['Draft', 'In Review', 'Approved'];
            const amountFieldDef = previewDef.fields.find((f) => f.key === 'amount');
            const isCurrency =
              /crm|sales|deal|contract|revenue/i.test(previewDef.name) ||
              /value|\$/i.test(amountFieldDef?.label ?? '');
            const metricComponents = previewDef.components.filter(
              (c) => c.type === 'metric'
            );
            const hasKanban = previewDef.components.some((c) => c.type === 'kanban');
            const hasTable = previewDef.components.some((c) => c.type === 'table');
            const hasCalendar = previewDef.components.some((c) => c.type === 'calendar');
            const hasAgentChat = previewDef.components.some((c) => c.type === 'agent_chat');

            const themePalette = {
              obsidian: {
                cardBg: '#131316',
                subCardBg: '#1a1a1f',
                border: '#1f1f24',
                accent: '#0088ff',
                text: '#f4f4f6',
              },
              cyber: {
                cardBg: '#0d1522',
                subCardBg: '#132035',
                border: '#1e3a8a',
                accent: '#38bdf8',
                text: '#f0f9ff',
              },
              glass: {
                cardBg: 'rgba(28, 28, 36, 0.72)',
                subCardBg: 'rgba(39, 39, 50, 0.75)',
                border: 'rgba(255, 255, 255, 0.12)',
                accent: '#10b981',
                text: '#f4f4f6',
              },
              light: {
                cardBg: '#f4f4f6',
                subCardBg: '#ffffff',
                border: '#d4d4d8',
                accent: '#0066cc',
                text: '#18181b',
              },
            }[uiTheme];

            const cardStyle: React.CSSProperties = {
              backgroundColor: themePalette.cardBg,
              border: `1px solid ${themePalette.border}`,
              borderRadius: 12,
              color: themePalette.text,
              transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
              boxShadow:
                uiMotion === 'glow'
                  ? `0 0 20px -6px ${themePalette.accent}44`
                  : '0 4px 12px rgba(0,0,0,0.2)',
            };

            const computeMetricValue = (op?: 'count' | 'sum' | 'avg') => {
              if (op === 'count') return activeAppRecords.length.toLocaleString();
              const nums = activeAppRecords.map((r) => Number(r.fields.amount ?? 0));
              const sum = nums.reduce((a, b) => a + b, 0);
              if (op === 'avg') {
                const avg = nums.length > 0 ? Math.round(sum / nums.length) : 0;
                return isCurrency ? `$${avg.toLocaleString()}` : avg.toLocaleString();
              }
              return isCurrency ? `$${sum.toLocaleString()}` : sum.toLocaleString();
            };

            const uxChecks = [
              {
                name: 'Strict Component Schema (Zero-Eval)',
                passed: previewDef.components.length > 0,
              },
              {
                name: 'Interactive KPI Metrics & Form Bound',
                passed: metricComponents.length > 0,
              },
              {
                name: 'Status Workflow Stages Configured',
                passed: statusStages.length >= 2,
              },
              {
                name: 'Responsive Layout & Theme Contrast',
                passed: true,
              },
              {
                name: 'AES-256-GCM Record Encryption Active',
                passed: true,
              },
              {
                name: 'Guest Snapshot Ready (/share/' + activeApp.id + ')',
                passed: activeApp.publishedSnapshotVersion !== null,
              },
            ];

            return (
              <div
                style={{
                  flex: 1,
                  padding: '16px 24px 80px 24px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                {/* Minimalist Single-Row Studio Bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {apps.map((appItem) => {
                      const isSelected = codeTab !== 'marketplace' && appItem.id === activeApp.id;
                      return (
                        <button
                          key={appItem.id}
                          onClick={() => {
                            setSelectedAppId(appItem.id);
                            setProposedDiff(null);
                            if (codeTab === 'marketplace') setCodeTab('app');
                          }}
                          style={{
                            backgroundColor: isSelected ? '#0088ff' : '#131316',
                            color: isSelected ? '#ffffff' : '#a1a1aa',
                            border: isSelected ? 'none' : '1px solid #222226',
                            borderRadius: 8,
                            padding: '5px 11px',
                            fontSize: 12,
                            fontWeight: isSelected ? 600 : 400,
                            cursor: 'pointer',
                          }}
                        >
                          {appItem.draftDefinition.name}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {(
                      [
                        { id: 'app', label: 'App' },
                        { id: 'marketplace', label: 'Marketplace' },
                        { id: 'builder', label: 'Builder' },
                        {
                          id: 'audit',
                          label: `Audit (${uxChecks.filter((c) => c.passed).length}/6)`,
                        },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setCodeTab(tab.id)}
                        style={{
                          backgroundColor: codeTab === tab.id ? '#1f1f24' : 'transparent',
                          border: '1px solid #222226',
                          borderRadius: 8,
                          padding: '5px 10px',
                          fontSize: 11,
                          color: codeTab === tab.id ? '#f4f4f6' : '#8e8e93',
                          fontWeight: codeTab === tab.id ? 600 : 400,
                          cursor: 'pointer',
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}

                    <button
                      onClick={() => {
                        const url = `${window.location.origin}/share/${activeApp.id}`;
                        void navigator.clipboard?.writeText(url);
                        notify('Copied Guest Link — opening...');
                        window.open(`/share/${activeApp.id}`, '_blank');
                      }}
                      title="Open & copy public Guest link"
                      style={{
                        backgroundColor: '#131316',
                        border: '1px solid #222226',
                        borderRadius: 8,
                        padding: '5px 10px',
                        fontSize: 11,
                        color: '#60a5fa',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Link2 size={12} />
                      <span>Share</span>
                    </button>

                    <button
                      onClick={() => void handlePublishApp(activeApp)}
                      style={{
                        backgroundColor: '#0088ff',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '5px 11px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Publish v{activeApp.publishedSnapshotVersion ?? 1}
                    </button>
                  </div>
                </div>

                {/* Builder Controls: Only visible when in 'builder' tab */}
                {codeTab === 'builder' && previewViewport !== 'guest' && (
                  <div
                    style={{
                      backgroundColor: '#111114',
                      border: '1px solid #1f1f24',
                      borderRadius: 12,
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={builderInstruction}
                        onChange={(e) => setBuilderInstruction(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleProposeDiff(activeApp.id);
                        }}
                        placeholder="Gemini Builder prompt: 'Add agent chat', 'Add average metric', 'Build Inventory'..."
                        style={{
                          flex: 1,
                          backgroundColor: '#18181c',
                          border: '1px solid #25252b',
                          borderRadius: 8,
                          padding: '7px 12px',
                          fontSize: 12,
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => void handleProposeDiff(activeApp.id)}
                        style={{
                          backgroundColor: '#0088ff',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 8,
                          padding: '0 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Build Diff
                      </button>
                      <button
                        onClick={() => void handleCreateAppFromPrompt(builderInstruction)}
                        style={{
                          backgroundColor: '#18181c',
                          color: '#a1a1aa',
                          border: '1px solid #25252b',
                          borderRadius: 8,
                          padding: '0 12px',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        New App
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                        {[
                          { label: '+ Metric', instruction: 'Add average metric card' },
                          { label: '+ Kanban', instruction: 'Add kanban board' },
                          { label: '+ Table', instruction: 'Add table grid' },
                          { label: '+ Calendar', instruction: 'Add calendar schedule' },
                          { label: '+ Agent Chat', instruction: 'Add agent chat assistant' },
                        ].map((chip) => (
                          <button
                            key={chip.label}
                            onClick={() => void handleProposeDiff(activeApp.id, chip.instruction)}
                            style={{
                              backgroundColor: '#18181c',
                              border: '1px solid #222228',
                              borderRadius: 6,
                              padding: '3px 8px',
                              fontSize: 11,
                              color: '#8e8e93',
                              cursor: 'pointer',
                            }}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                        {(['obsidian', 'cyber', 'glass', 'light'] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setUiTheme(t)}
                            style={{
                              backgroundColor: uiTheme === t ? '#27272a' : 'transparent',
                              border: '1px solid #25252b',
                              borderRadius: 6,
                              padding: '3px 7px',
                              fontSize: 10,
                              color: uiTheme === t ? '#ffffff' : '#71717a',
                              cursor: 'pointer',
                              textTransform: 'capitalize',
                            }}
                          >
                            {t}
                          </button>
                        ))}

                        <button
                          onClick={() =>
                            setUiMotion((m) => (m === 'spring' ? 'glow' : 'spring'))
                          }
                          style={{
                            backgroundColor: uiMotion === 'glow' ? '#1e3a8a' : 'transparent',
                            border: '1px solid #25252b',
                            borderRadius: 6,
                            padding: '3px 7px',
                            fontSize: 10,
                            color: uiMotion === 'glow' ? '#93c5fd' : '#71717a',
                            cursor: 'pointer',
                          }}
                        >
                          {uiMotion === 'glow' ? '✦ Glow FX' : '⚡ Spring'}
                        </button>

                        {(['desktop', 'mobile', 'guest'] as const).map((vp) => (
                          <button
                            key={vp}
                            onClick={() => setPreviewViewport(vp)}
                            style={{
                              backgroundColor: previewViewport === vp ? '#0088ff' : 'transparent',
                              border: '1px solid #25252b',
                              borderRadius: 6,
                              padding: '3px 7px',
                              fontSize: 10,
                              color: previewViewport === vp ? '#ffffff' : '#71717a',
                              cursor: 'pointer',
                              textTransform: 'capitalize',
                            }}
                          >
                            {vp}
                          </button>
                        ))}
                      </div>
                    </div>

                    {proposedDiff && proposedDiff.appId === activeApp.id && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          backgroundColor: '#161b26',
                          border: '1px solid #1e3a8a',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: '#93c5fd' }}>
                          Preview: {proposedDiff.summary} (+{proposedDiff.addedComponentIds.length} / ~
                          {proposedDiff.modifiedComponentIds.length})
                        </span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setProposedDiff(null)}
                            style={{
                              backgroundColor: 'transparent',
                              color: '#a1a1aa',
                              border: '1px solid #2c2c32',
                              borderRadius: 6,
                              padding: '4px 10px',
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            Discard
                          </button>
                          <button
                            onClick={() => void handleApplyDiff()}
                            style={{
                              backgroundColor: '#0088ff',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: 6,
                              padding: '4px 12px',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {previewViewport === 'guest' && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 12px',
                      borderRadius: 8,
                      backgroundColor: '#131316',
                      border: '1px solid #222226',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: '#60a5fa' }}>
                      Guest Preview Mode · /share/{activeApp.id}
                    </span>
                    <button
                      onClick={() => setPreviewViewport('desktop')}
                      style={{
                        backgroundColor: '#1f1f24',
                        color: '#e5e5e7',
                        border: 'none',
                        borderRadius: 6,
                        padding: '3px 9px',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Exit Guest Preview
                    </button>
                  </div>
                )}

                {codeTab === 'app' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                      maxWidth: previewViewport === 'mobile' ? 410 : '100%',
                      width: '100%',
                      margin: previewViewport === 'mobile' ? '0 auto' : undefined,
                      transition: 'max-width 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                  >
                    {/* Dynamic Metrics + Quick Record Intake Bar */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          previewViewport === 'mobile'
                            ? '1fr'
                            : `repeat(${Math.max(1, metricComponents.length)}, 1fr) 2fr`,
                        gap: 12,
                      }}
                    >
                      {metricComponents.map((mc) => (
                        <div key={mc.id} style={{ ...cardStyle, padding: 14 }}>
                          <div style={{ fontSize: 11, opacity: 0.65 }}>
                            {mc.label ?? 'Metric'}
                          </div>
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 700,
                              marginTop: 4,
                              color: themePalette.accent,
                            }}
                          >
                            {computeMetricValue(mc.metricOperation)}
                          </div>
                        </div>
                      ))}

                      <div
                        style={{
                          ...cardStyle,
                          padding: 14,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <input
                          value={newDealTitle}
                          onChange={(e) => setNewDealTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleCreateDealRecord(activeApp.id);
                          }}
                          placeholder={`${
                            previewDef.fields.find((f) => f.key === 'title')?.label ?? 'Item'
                          }...`}
                          style={{
                            flex: 1,
                            backgroundColor: themePalette.subCardBg,
                            color: themePalette.text,
                            border: 'none',
                            borderRadius: 7,
                            padding: '7px 10px',
                            fontSize: 12,
                            outline: 'none',
                          }}
                        />
                        <input
                          value={newDealAmount}
                          onChange={(e) => setNewDealAmount(e.target.value)}
                          placeholder={amountFieldDef?.label ?? 'Value'}
                          style={{
                            width: 84,
                            backgroundColor: themePalette.subCardBg,
                            color: themePalette.text,
                            border: 'none',
                            borderRadius: 7,
                            padding: '7px 10px',
                            fontSize: 12,
                            outline: 'none',
                          }}
                        />
                        <button
                          onClick={() => void handleCreateDealRecord(activeApp.id)}
                          style={{
                            backgroundColor: themePalette.accent,
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 7,
                            padding: '7px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Dynamic Kanban Component */}
                    {hasKanban && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            previewViewport === 'mobile'
                              ? '1fr'
                              : `repeat(${statusStages.length}, 1fr)`,
                          gap: 12,
                        }}
                      >
                        {statusStages.map((stage, stageIdx) => {
                          const stageRecords = activeAppRecords.filter(
                            (r) => String(r.fields.status) === stage
                          );
                          const nextStage = statusStages[stageIdx + 1];
                          return (
                            <div key={stage} style={{ ...cardStyle, padding: 12 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  fontSize: 11,
                                  opacity: 0.7,
                                  marginBottom: 10,
                                }}
                              >
                                <span>{stage}</span>
                                <span>{stageRecords.length}</span>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {stageRecords.map((rec) => (
                                  <div
                                    key={rec.id}
                                    style={{
                                      backgroundColor: themePalette.subCardBg,
                                      borderRadius: 8,
                                      padding: 10,
                                      fontSize: 12,
                                      transition: 'transform 0.18s ease',
                                    }}
                                  >
                                    <div style={{ fontWeight: 600 }}>
                                      {String(rec.fields.title ?? rec.id)}
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginTop: 6,
                                        fontSize: 11,
                                        opacity: 0.75,
                                      }}
                                    >
                                      <span>
                                        {isCurrency
                                          ? `$${Number(rec.fields.amount ?? 0).toLocaleString()}`
                                          : `${Number(rec.fields.amount ?? 0).toLocaleString()} units`}
                                      </span>
                                      {nextStage && (
                                        <button
                                          onClick={() =>
                                            void handleTransitionRecord(
                                              activeApp.id,
                                              rec,
                                              nextStage
                                            )
                                          }
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            color:
                                              stageIdx === statusStages.length - 2
                                                ? '#10b981'
                                                : themePalette.accent,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                          }}
                                        >
                                          {nextStage} →
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Dynamic Table Component (shown when Kanban is not present) */}
                    {hasTable && !hasKanban && (
                      <div style={{ ...cardStyle, overflow: 'hidden' }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '2fr 1fr 1fr 1fr',
                            padding: '9px 14px',
                            borderBottom: `1px solid ${themePalette.border}`,
                            fontSize: 11,
                            opacity: 0.65,
                          }}
                        >
                          <span>
                            {previewDef.fields.find((f) => f.key === 'title')?.label ?? 'Title'}
                          </span>
                          <span>Status</span>
                          <span>{amountFieldDef?.label ?? 'Amount'}</span>
                          <span>Date</span>
                        </div>
                        {activeAppRecords.map((rec) => (
                          <div
                            key={rec.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '2fr 1fr 1fr 1fr',
                              padding: '9px 14px',
                              borderBottom: `1px solid ${themePalette.border}`,
                              fontSize: 12,
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>
                              {String(rec.fields.title ?? rec.id)}
                            </span>
                            <span style={{ opacity: 0.75, fontSize: 11 }}>
                              {String(rec.fields.status ?? '')}
                            </span>
                            <span>
                              {isCurrency
                                ? `$${Number(rec.fields.amount ?? 0).toLocaleString()}`
                                : Number(rec.fields.amount ?? 0).toLocaleString()}
                            </span>
                            <span style={{ opacity: 0.65, fontSize: 11 }}>
                              {String(rec.fields.dueDate ?? '—')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Compact Embedded Gemini Agent Chat */}
                    {hasAgentChat && (
                      <div
                        style={{
                          ...cardStyle,
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            value={appChatInput}
                            onChange={(e) => setAppChatInput(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter' && appChatInput.trim()) {
                                const res = await fetch('/api/low', {
                                  method: 'POST',
                                  headers: apiHeaders,
                                  body: JSON.stringify({
                                    operation: 'ask_memory',
                                    data: {
                                      question: appChatInput,
                                      collectionIds: collections.map((c) => c.id),
                                    },
                                  }),
                                });
                                const d = await res.json();
                                if (res.ok && d.answer) {
                                  setAppChatReply(d.answer.answerMarkdown);
                                }
                              }
                            }}
                            placeholder="Ask Gemini Agent about this app..."
                            style={{
                              flex: 1,
                              backgroundColor: themePalette.subCardBg,
                              color: themePalette.text,
                              border: 'none',
                              borderRadius: 8,
                              padding: '7px 12px',
                              fontSize: 12,
                              outline: 'none',
                            }}
                          />
                          <button
                            onClick={async () => {
                              if (!appChatInput.trim()) return;
                              const res = await fetch('/api/low', {
                                method: 'POST',
                                headers: apiHeaders,
                                body: JSON.stringify({
                                  operation: 'ask_memory',
                                  data: {
                                    question: appChatInput,
                                    collectionIds: collections.map((c) => c.id),
                                  },
                                }),
                              });
                              const d = await res.json();
                              if (res.ok && d.answer) {
                                setAppChatReply(d.answer.answerMarkdown);
                              }
                            }}
                            style={{
                              backgroundColor: themePalette.accent,
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: 8,
                              padding: '7px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <Send size={13} />
                          </button>
                        </div>
                        {appChatReply && (
                          <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.9 }}>
                            <ReactMarkdown>{appChatReply}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {codeTab === 'marketplace' && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 12,
                    }}
                  >
                    {[
                      {
                        title: 'Enterprise Deal & Approval CRM',
                        category: 'CRM',
                        tags: 'Kanban · KPI · HMAC Gate',
                        matchId: 'app-crm-approvals',
                        prompt: 'Customer CRM & Deal Pipeline',
                      },
                      {
                        title: 'Inventory & Stock Manager',
                        category: 'Operations',
                        tags: 'Stock Levels · Reorder · Table',
                        matchId: 'app-inventory',
                        prompt: 'Inventory & Stock Manager',
                      },
                      {
                        title: 'AI Sprint & Bug Tracker',
                        category: 'Engineering',
                        tags: 'Triage · Sprint Board · SLA',
                        matchId: '',
                        prompt: 'Project & Operations Tracker',
                      },
                      {
                        title: 'Client Onboarding & KYC Portal',
                        category: 'Compliance',
                        tags: 'Checklist · Risk Approval · Chat',
                        matchId: '',
                        prompt: 'Client Onboarding & KYC Compliance Tracker',
                      },
                      {
                        title: 'Finance & Burn Rate Ledger',
                        category: 'Finance',
                        tags: 'Budget · Vendor Spend · KPI',
                        matchId: '',
                        prompt: 'Finance & Budget Approval Tracker',
                      },
                      {
                        title: 'Talent & Recruiting Pipeline',
                        category: 'People',
                        tags: 'Candidates · Offer Gate · Kanban',
                        matchId: '',
                        prompt: 'Recruiting & Candidate Pipeline CRM',
                      },
                    ].map((tpl) => {
                      const existing = apps.find(
                        (a) =>
                          (tpl.matchId && a.id === tpl.matchId) ||
                          a.draftDefinition.name.toLowerCase() === tpl.title.toLowerCase()
                      );
                      return (
                        <div
                          key={tpl.title}
                          style={{
                            backgroundColor: '#131316',
                            border: '1px solid #1f1f24',
                            borderRadius: 12,
                            padding: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 14,
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: '#60a5fa',
                                  backgroundColor: '#161f30',
                                  padding: '2px 7px',
                                  borderRadius: 5,
                                }}
                              >
                                {tpl.category}
                              </span>
                              <span style={{ fontSize: 10, color: '#71717a' }}>Gemini Ready</span>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6', marginTop: 2 }}>
                              {tpl.title}
                            </div>
                            <div style={{ fontSize: 11, color: '#71717a' }}>{tpl.tags}</div>
                          </div>

                          <button
                            onClick={async () => {
                              if (existing) {
                                setSelectedAppId(existing.id);
                                setCodeTab('app');
                              } else {
                                await handleCreateAppFromPrompt(tpl.prompt);
                                setCodeTab('app');
                              }
                            }}
                            style={{
                              width: '100%',
                              backgroundColor: existing ? '#1c1c21' : '#0088ff',
                              color: '#ffffff',
                              border: existing ? '1px solid #2c2c32' : 'none',
                              borderRadius: 8,
                              padding: '7px 0',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {existing ? 'Open App' : 'Use Ready App'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {codeTab === 'builder' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {previewDef.components.map((c) => (
                        <span
                          key={c.id}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 7,
                            backgroundColor: '#131316',
                            border: '1px solid #1f1f24',
                            fontSize: 11,
                            color: '#d4d4d8',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span>
                            <strong style={{ color: '#0088ff' }}>{c.type}</strong> · {c.label ?? c.id}
                          </span>
                          {c.type !== 'page' && (
                            <button
                              onClick={async () => {
                                const res = await fetch('/api/low', {
                                  method: 'POST',
                                  headers: apiHeaders,
                                  body: JSON.stringify({
                                    operation: 'remove_app_component',
                                    data: {
                                      appId: activeApp.id,
                                      componentId: c.id,
                                    },
                                  }),
                                });
                                if (res.ok) {
                                  await refreshWorkspace();
                                  notify(`Removed ${c.label ?? c.id}`);
                                }
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#71717a',
                                cursor: 'pointer',
                                fontSize: 12,
                                padding: 0,
                                lineHeight: 1,
                              }}
                              title="Remove component"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>

                    <pre
                      style={{
                        backgroundColor: '#111113',
                        border: '1px solid #1f1f24',
                        borderRadius: 10,
                        padding: 12,
                        fontSize: 11,
                        color: '#a1a1aa',
                        overflowX: 'auto',
                        maxHeight: 360,
                      }}
                    >
                      {JSON.stringify(previewDef, null, 2)}
                    </pre>
                  </div>
                )}

                {codeTab === 'audit' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Pre-Publish UX/UI & Security Audit Scorecard */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 8,
                      }}
                    >
                      {uxChecks.map((chk) => (
                        <div
                          key={chk.name}
                          style={{
                            backgroundColor: '#131316',
                            border: '1px solid #1f1f24',
                            borderRadius: 8,
                            padding: '8px 10px',
                            fontSize: 11,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ color: '#d4d4d8' }}>{chk.name}</span>
                          <span style={{ color: chk.passed ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                            {chk.passed ? 'PASS' : 'WARN'}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Append-Only Security & Workflow Audit Log */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {auditEvents.map((ev) => (
                        <div
                          key={ev.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            backgroundColor: '#131316',
                            borderRadius: 6,
                            fontSize: 11,
                            color: '#a1a1aa',
                          }}
                        >
                          <span>
                            {ev.action} · {ev.targetId}
                          </span>
                          <span style={{ color: '#52525b' }}>{ev.actor}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* =============================================================== */}
          {/* FLOATING BOTTOM-RIGHT MIC & + BUTTONS                           */}
          {/* =============================================================== */}
          <div
            style={{
              position: 'absolute',
              right: 22,
              bottom: 22,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              zIndex: 20,
            }}
          >
            <button
              onClick={() => setMicModalOpen(true)}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                backgroundColor: '#1e1e24',
                border: '1px solid #2e2e36',
                color: '#e5e5e7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Mic size={18} />
            </button>

            {viewMode !== 'editor' && (
              <button
                onClick={() => setNewFileModalOpen(true)}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  backgroundColor: '#0088ff',
                  border: 'none',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Plus size={22} />
              </button>
            )}
          </div>
        </main>

        {/* ================================================================= */}
        {/* RIGHT SIDEBAR (Matches Screenshots 1-5)                           */}
        {/* ================================================================= */}
        {sidebarOpen && (
          <aside
            style={{
              width: 280,
              backgroundColor: '#111113',
              borderLeft: '1px solid #18181b',
              padding: '12px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflowY: 'auto',
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setViewMode('inbox')}
              style={{
                width: '100%',
                height: 36,
                backgroundColor: '#18181b',
                border: '1px solid #222226',
                borderRadius: 9,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12,
                color: '#d4d4d8',
                cursor: 'pointer',
              }}
            >
              <Inbox size={14} color="#8e8e93" />
              <span>Inbox</span>
            </button>

            <button
              onClick={() => setViewMode('code')}
              style={{
                width: '100%',
                height: 36,
                backgroundColor: '#18181b',
                border: '1px solid #222226',
                borderRadius: 9,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12,
                color: '#d4d4d8',
                cursor: 'pointer',
              }}
            >
              <Code2 size={14} color="#8e8e93" />
              <span>Code</span>
            </button>

            <div style={{ marginTop: 6 }}>
              <div
                onClick={() => setVaultsExpanded((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 6px',
                  fontSize: 11,
                  color: '#71717a',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {vaultsExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span>Vaults</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewItemKind('folder');
                    setNewFileModalOpen(true);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#71717a',
                    cursor: 'pointer',
                  }}
                >
                  <FolderPlus size={12} />
                </button>
              </div>

              {vaultsExpanded && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    marginTop: 4,
                    paddingLeft: 6,
                  }}
                >
                  {liveFolders.map((folder) => {
                    const children = liveFiles.filter((f) => f.parentId === folder.id);
                    const isOpen = expandedFolders[folder.id] ?? true;
                    return (
                      <div key={folder.id}>
                        <div
                          onClick={() =>
                            setExpandedFolders((prev) => ({
                              ...prev,
                              [folder.id]: !isOpen,
                            }))
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 8px',
                            borderRadius: 7,
                            cursor: 'pointer',
                            fontSize: 12,
                            color: '#d4d4d8',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            {isOpen ? (
                              <ChevronDown size={11} color="#71717a" />
                            ) : (
                              <ChevronRight size={11} color="#71717a" />
                            )}
                            <Folder size={13} color="#8e8e93" fill="#8e8e93" />
                            <span>{folder.name}</span>
                          </div>
                          <span style={{ fontSize: 10, color: '#52525b' }}>
                            {children.length}
                          </span>
                        </div>

                        {isOpen && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                              paddingLeft: 18,
                            }}
                          >
                            {children.map((file) => {
                              const isSelected =
                                viewMode === 'editor' && activeDoc?.id === file.id;
                              return (
                                <div
                                  key={file.id}
                                  onClick={() => openDocumentInEditor(file)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '6px 10px',
                                    borderRadius: 7,
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    backgroundColor: isSelected
                                      ? '#1c1c21'
                                      : 'transparent',
                                    color: isSelected ? '#ffffff' : '#d4d4d8',
                                  }}
                                >
                                  <FileText size={13} color="#a1a1aa" />
                                  <span
                                    style={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {file.name}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {liveFiles
                    .filter((f) => f.parentId === null)
                    .map((file) => {
                      const isSelected =
                        viewMode === 'editor' && activeDoc?.id === file.id;
                      return (
                        <div
                          key={file.id}
                          onClick={() => openDocumentInEditor(file)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '7px 10px',
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontSize: 12,
                            backgroundColor: isSelected ? '#1c1c21' : 'transparent',
                            color: isSelected ? '#ffffff' : '#d4d4d8',
                          }}
                        >
                          <FileText size={13} color="#a1a1aa" />
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {file.name}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <div
              style={{
                borderTop: '1px solid #18181b',
                marginTop: 8,
                paddingTop: 8,
              }}
            >
              <div
                onClick={() => setSharedExpanded((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  fontSize: 11,
                  color: '#71717a',
                  cursor: 'pointer',
                }}
              >
                {sharedExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span>Shared</span>
              </div>
              {sharedExpanded && (
                <div style={{ padding: '4px 12px', fontSize: 11, color: '#71717a' }}>
                  {collections.map((c) => (
                    <div key={c.id}>{c.name}</div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                borderTop: '1px solid #18181b',
                marginTop: 4,
                paddingTop: 8,
              }}
            >
              <div
                onClick={() => setBinExpanded((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  fontSize: 11,
                  color: '#71717a',
                  cursor: 'pointer',
                }}
              >
                {binExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span>Bin</span>
                <span style={{ fontSize: 10, color: '#52525b' }}>
                  {archivedDocs.length}
                </span>
              </div>

              {binExpanded && (
                <div style={{ padding: '6px 12px', fontSize: 11, color: '#52525b' }}>
                  {archivedDocs.length === 0 ? (
                    <div>The Bin is empty</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {archivedDocs.map((doc) => (
                        <div
                          key={doc.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            color: '#9ca3af',
                          }}
                        >
                          <span>{doc.name}</span>
                          <button
                            onClick={() => void handleRestoreDocument(doc)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#0088ff',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <RotateCcw size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* =================================================================== */}
      {/* MINIMAL VOICE MODAL                                                 */}
      {/* =================================================================== */}
      {micModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: 380,
              backgroundColor: '#141417',
              border: '1px solid #242429',
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span>Voice Note</span>
              <button
                onClick={() => setMicModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer' }}
              >
                <X size={15} />
              </button>
            </div>

            <textarea
              value={voiceTranscriptInput}
              onChange={(e) => setVoiceTranscriptInput(e.target.value)}
              placeholder="Speak or type transcript..."
              rows={3}
              style={{
                width: '100%',
                backgroundColor: '#1c1c21',
                border: 'none',
                borderRadius: 8,
                padding: 10,
                fontSize: 12,
                color: '#e5e5e7',
                outline: 'none',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button
                onClick={() => void handleCaptureVoice()}
                style={{
                  backgroundColor: '#0088ff',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MINIMAL NEW FILE / FOLDER MODAL                                     */}
      {/* =================================================================== */}
      {newFileModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: 380,
              backgroundColor: '#141417',
              border: '1px solid #242429',
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span>New</span>
              <button
                onClick={() => setNewFileModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer' }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button
                onClick={() => setNewItemKind('file')}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  borderRadius: 7,
                  border: 'none',
                  backgroundColor: newItemKind === 'file' ? '#0088ff' : '#1c1c21',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                File
              </button>
              <button
                onClick={() => setNewItemKind('folder')}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  borderRadius: 7,
                  border: 'none',
                  backgroundColor: newItemKind === 'folder' ? '#0088ff' : '#1c1c21',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Folder
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Name"
                style={{
                  backgroundColor: '#1c1c21',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  outline: 'none',
                }}
              />

              <select
                value={newItemParentId}
                onChange={(e) => setNewItemParentId(e.target.value)}
                style={{
                  backgroundColor: '#1c1c21',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  outline: 'none',
                }}
              >
                <option value="">Vault</option>
                {liveFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>

              {newItemKind === 'file' && (
                <textarea
                  value={newItemBody}
                  onChange={(e) => setNewItemBody(e.target.value)}
                  placeholder="Markdown..."
                  rows={4}
                  style={{
                    backgroundColor: '#1c1c21',
                    border: 'none',
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button
                onClick={() => void handleCreateItem()}
                style={{
                  backgroundColor: '#0088ff',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {modelModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 130,
          }}
        >
          <div
            style={{
              width: 440,
              backgroundColor: '#141418',
              border: '1px solid #27272a',
              borderRadius: 14,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Google Gemini & Vertex AI Models</span>
              <button
                onClick={() => setModelModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#8e8e93', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Google Provider Selector */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {(
                [
                  { id: 'gemini', label: 'Google Gemini API', defaultModel: 'gemini-2.5-flash' },
                  { id: 'vertex', label: 'Google Cloud Vertex AI', defaultModel: 'gemini-2.5-flash' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setNnProvider(p.id);
                    setNnModel(p.defaultModel);
                  }}
                  style={{
                    padding: '7px 0',
                    borderRadius: 8,
                    border: '1px solid #27272a',
                    backgroundColor: nnProvider === p.id ? '#0088ff' : '#1c1c21',
                    color: nnProvider === p.id ? '#ffffff' : '#a1a1aa',
                    fontSize: 11,
                    fontWeight: nnProvider === p.id ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Google Gemini Model Presets */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'].map(
                (m) => (
                  <button
                    key={m}
                    onClick={() => setNnModel(m)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 7,
                      border: '1px solid #27272a',
                      backgroundColor: nnModel === m ? '#27272a' : '#18181c',
                      color: nnModel === m ? '#60a5fa' : '#8e8e93',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {m}
                  </button>
                )
              )}
            </div>

            {/* API Key Input */}
            <input
              type="password"
              value={nnApiKey}
              onChange={(e) => setNnApiKey(e.target.value)}
              placeholder={
                nnProvider === 'vertex'
                  ? 'Uses Google Cloud Run IAM Service Account (or paste Gemini API key)...'
                  : 'Paste GEMINI_API_KEY (optional for built-in deterministic grounding)...'
              }
              style={{
                backgroundColor: '#1c1c21',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
                color: '#f4f4f6',
                outline: 'none',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#10b981' }}>
                ● Active: {nnApiKey.trim() ? 'Live Gemini API Key' : nnProvider === 'vertex' ? 'Vertex AI / Cloud Run' : 'Built-in Grounded Mode'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    await handleSaveNeuralConfig(nnProvider, nnModel, nnApiKey);
                    setSidebarOpen(true);
                    setMemoryQuestion('Summarize my vault and active deals');
                    await handleAskMemory('Summarize my vault and active deals');
                  }}
                  style={{
                    backgroundColor: '#1c1c21',
                    color: '#60a5fa',
                    border: '1px solid #2c2c32',
                    borderRadius: 8,
                    padding: '7px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save & Test Model
                </button>
                <button
                  onClick={() => void handleSaveNeuralConfig(nnProvider, nnModel, nnApiKey)}
                  style={{
                    backgroundColor: '#0088ff',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '7px 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save Neural Network
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mcpModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 120,
          }}
        >
          <div
            style={{
              width: 440,
              backgroundColor: '#141418',
              border: '1px solid #27272a',
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Connect LOW Memory to Antigravity</span>
              <button
                onClick={() => setMcpModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#8e8e93', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            </div>

            {(() => {
              const origin =
                typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
              const mcpUrl = `${origin}/api/mcp`;
              const mcpJson = JSON.stringify(
                {
                  mcpServers: {
                    'low-memory': {
                      url: mcpUrl,
                    },
                  },
                },
                null,
                2
              );
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: '#1c1c21',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mcpUrl}
                    </span>
                    <button
                      onClick={() => {
                        void navigator.clipboard?.writeText(mcpUrl);
                        notify('Copied MCP URL');
                      }}
                      style={{
                        backgroundColor: '#0088ff',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 6,
                        padding: '4px 10px',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Copy URL
                    </button>
                  </div>

                  <pre
                    style={{
                      backgroundColor: '#111114',
                      border: '1px solid #222226',
                      borderRadius: 8,
                      padding: 10,
                      fontSize: 11,
                      color: '#d4d4d8',
                      margin: 0,
                      overflowX: 'auto',
                    }}
                  >
                    {mcpJson}
                  </pre>

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <button
                      onClick={() => {
                        void navigator.clipboard?.writeText(
                          `npm run connect:antigravity -- ${origin}`
                        );
                        notify('Copied CLI command');
                      }}
                      style={{
                        flex: 1,
                        backgroundColor: '#1c1c21',
                        color: '#e5e5e7',
                        border: '1px solid #2c2c32',
                        borderRadius: 8,
                        padding: '7px 12px',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Copy 1-Command Auto-Connect
                    </button>
                    <button
                      onClick={() => {
                        void navigator.clipboard?.writeText(mcpJson);
                        notify('Copied mcp_config.json');
                      }}
                      style={{
                        flex: 1,
                        backgroundColor: '#0088ff',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '7px 12px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Copy MCP JSON
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {statusToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#18181b',
            border: '1px solid #27272a',
            color: '#e5e5e7',
            padding: '6px 14px',
            borderRadius: 8,
            fontSize: 11,
            zIndex: 200,
          }}
        >
          {statusToast}
        </div>
      )}
    </div>
  );
}
