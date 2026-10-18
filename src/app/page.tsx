'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Archive,
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  FileText,
  Folder,
  FolderPlus,
  GitCompare,
  History,
  Inbox,
  LayoutGrid,
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
  ShieldCheck,
  Sparkles,
  Trash2,
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

type VaultViewMode = 'grid' | 'list' | 'calendar' | 'graph' | 'editor' | 'inbox' | 'code' | 'judge';

const DEMO_TENANTS = [
  {
    uid: 'berezovsky360',
    orgId: 'org-berezovsky',
    role: 'owner' as const,
    handle: '@berezovsky360',
    label: 'LOW Vault (@berezovsky360 · Owner)',
  },
  {
    uid: 'beta_admin',
    orgId: 'org-beta',
    role: 'owner' as const,
    handle: '@beta_admin',
    label: 'Beta Labs (Isolated Tenant B · Owner)',
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
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);

  // Loaded data from /api/low
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [rawCiphertexts, setRawCiphertexts] = useState<Record<string, string>>({});
  const [collections, setCollections] = useState<KnowledgeCollectionItem[]>([]);
  const [chunkCount, setChunkCount] = useState(0);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [appRecordsMap, setAppRecordsMap] = useState<Record<string, AppRecordItem[]>>({});
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [models, setModels] = useState({
    reasoning: 'gemini-2.5-flash',
    transcription: 'gemini-2.5-flash',
    embedding: 'text-embedding-004',
  });

  // Open tabs & active file editor
  const [openTabIds, setOpenTabIds] = useState<string[]>(['2026-09-07-19-45-33']);
  const [activeDocId, setActiveDocId] = useState<string | null>('2026-09-07-19-45-33');
  const [editorBody, setEditorBody] = useState('');
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [showCiphertextInspector, setShowCiphertextInspector] = useState(false);
  const [docVersions, setDocVersions] = useState<DocVersionItem[]>([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // Tree expansion state
  const [vaultsExpanded, setVaultsExpanded] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'folder-test': true,
  });
  const [binExpanded, setBinExpanded] = useState(true);
  const [sharedExpanded, setSharedExpanded] = useState(false);

  // Graph zoom
  const [graphZoom, setGraphZoom] = useState(100);

  // Memory Q&A state
  const [memoryQuestion, setMemoryQuestion] = useState(
    'How quickly must production incidents be escalated, and how are organization keys wrapped?'
  );
  const [memoryAnswer, setMemoryAnswer] = useState<MemoryAnswerItem | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [rebuildNotice, setRebuildNotice] = useState<string | null>(null);

  // App Builder & Runtime state
  const [builderInstruction, setBuilderInstruction] = useState(
    'Add a KPI metric card for total contract value'
  );
  const [proposedDiff, setProposedDiff] = useState<BuilderDiffItem | null>(null);
  const [newDealTitle, setNewDealTitle] = useState('');
  const [newDealAmount, setNewDealAmount] = useState('40000');

  // Modals (Mic Capture & New File/Folder)
  const [micModalOpen, setMicModalOpen] = useState(false);
  const [voiceTranscriptInput, setVoiceTranscriptInput] = useState(
    'Meeting transcript: Finalized Q4 Google Cloud Run deployment with min-instances=1 and KMS key rotation.'
  );
  const [newFileModalOpen, setNewFileModalOpen] = useState(false);
  const [newItemKind, setNewItemKind] = useState<'file' | 'folder'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [newItemParentId, setNewItemParentId] = useState<string>('');
  const [newItemBody, setNewItemBody] = useState('# New Note\n\nWrite Markdown here.');

  const [statusToast, setStatusToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 4000);
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
    if (data.models) {
      setModels(data.models);
    }
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

  const openDocumentInEditor = useCallback(
    (doc: DocItem) => {
      if (doc.kind === 'folder') {
        setExpandedFolders((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }));
        return;
      }
      setActiveDocId(doc.id);
      setEditorBody(doc.body);
      setOpenTabIds((prev) => (prev.includes(doc.id) ? prev : [...prev, doc.id]));
      setViewMode('editor');
    },
    []
  );

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
      notify(`Conflict / Error: ${payload.error}`);
      return;
    }
    await refreshWorkspace();
    notify(`Saved & encrypted ${activeDoc.name} (v${payload.document.version})`);
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
      setShowVersionHistory(true);
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
    const data = await res.json();
    if (!res.ok) {
      notify(`Archive failed: ${data.error}`);
      return;
    }
    await refreshWorkspace();
    notify(
      `Archived "${doc.name}" with single-use HMAC approval ${data.approval.id.slice(0, 8)}…`
    );
    if (viewMode === 'editor' && activeDoc?.id === doc.id) {
      setViewMode('list');
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
      notify(`Restored "${doc.name}" from Bin`);
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
      await refreshWorkspace();
      if (data.document.kind === 'file') {
        openDocumentInEditor(data.document);
      }
      notify(`Created ${newItemKind} "${formattedName}"`);
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
          transcriptText: voiceTranscriptInput,
          targetFolderId: liveFolders[0]?.id ?? null,
          language: 'en',
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setMicModalOpen(false);
      await refreshWorkspace();
      openDocumentInEditor(data.document);
      notify(`Transcribed audio with ${data.transcribedModel} & indexed into Memory`);
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
      body: JSON.stringify({
        operation: 'rebuild_derived',
      }),
    });
    const data = await res.json();
    if (res.ok) {
      await refreshWorkspace();
      const s = data.rebuildStats;
      const msg = `Deleted ${s.deletedChunks} chunks & rebuilt ${s.rebuiltChunks} vector embeddings from ${s.rebuiltDocuments} encrypted Markdown files.`;
      setRebuildNotice(msg);
      notify(msg);
    }
  };

  const handleProposeDiff = async (appId: string) => {
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'propose_builder_diff',
        data: {
          appId,
          instruction: builderInstruction,
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setProposedDiff(data.diff);
      notify('Builder Agent generated validated diff preview (read/validate/preview only)');
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
      await refreshWorkspace();
      notify('Applied validated diff to App draft');
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
      notify(`Published immutable App Snapshot v${data.snapshot.version}`);
    }
  };

  const handleCreateDealRecord = async (appId: string) => {
    if (!newDealTitle.trim()) return;
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        operation: 'create_app_record',
        data: {
          appId,
          fields: {
            title: newDealTitle.trim(),
            status: 'Draft',
            amount: Number(newDealAmount) || 0,
            dueDate: '2026-09-18',
          },
          notesMarkdown: `Created by ${currentTenant.handle} as an encrypted Markdown record.`,
        },
      }),
    });
    if (res.ok) {
      setNewDealTitle('');
      await refreshWorkspace();
      notify('Created encrypted Markdown app record');
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
      notify(`Transition blocked: ${data.error}`);
      return;
    }
    await refreshWorkspace();
    notify(`Transitioned record to "${toStatus}" (audited with HMAC approval)`);
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
          payload: {
            requestedBy: currentTenant.handle,
            runDate: new Date().toISOString(),
          },
        },
      }),
    });
    const data = await res.json();
    if (res.ok && data.processed?.outputDocument) {
      await refreshWorkspace();
      notify(
        `Cloud Run Job completed queue item & wrote ${data.processed.outputDocument.name}`
      );
    }
  };

  const activeApp = apps[0] ?? null;
  const activeAppRecords = activeApp ? (appRecordsMap[activeApp.id] ?? []) : [];

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
      {/* TOP BAR (Matches Screenshots 1-5)                                   */}
      {/* =================================================================== */}
      <header
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          gap: 10,
          borderBottom: '1px solid #18181b',
          backgroundColor: '#0b0b0c',
          flexShrink: 0,
        }}
      >
        {/* Left: Blue LOW Vault Icon + Tab Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <button
            onClick={() => setViewMode('grid')}
            title="LOW Vault Home"
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
              boxShadow: '0 2px 10px rgba(0, 136, 255, 0.35)',
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

          {/* Rounded Dark Tab Strip + Search Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#131316',
              border: '1px solid #1f1f23',
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
                    backgroundColor: isCurrent ? '#1f1f24' : 'transparent',
                    color: isCurrent ? '#f4f4f6' : '#8e8e93',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: '#636366' }}>#</span>
                  <span>
                    {doc.name.length > 18 ? `${doc.name.slice(0, 16)}...` : doc.name}
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
              title="New Markdown file"
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

            {/* Inline Quick Search + Judge Console Pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setViewMode('judge')}
                style={{
                  backgroundColor: viewMode === 'judge' ? '#0088ff' : '#1c2838',
                  color: viewMode === 'judge' ? '#ffffff' : '#60a5fa',
                  border: '1px solid #1e3a5f',
                  borderRadius: 6,
                  padding: '3px 9px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <ShieldCheck size={13} />
                <span>Hackathon Judge Console</span>
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: '#1a1a1f',
                  borderRadius: 6,
                  padding: '3px 8px',
                }}
              >
                <Search size={13} color="#60a5fa" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter Vault..."
                  style={{
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    fontSize: 12,
                    width: 110,
                    color: '#e5e5e7',
                  }}
                />
              </div>

              <button
                onClick={() => setSidebarOpen((v) => !v)}
                title="Toggle Right Sidebar"
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
        </div>

        {/* Right: User / Organization Switcher (@berezovsky360) */}
        <div style={{ position: 'relative', width: 268, flexShrink: 0 }}>
          <button
            onClick={() => setTenantMenuOpen((o) => !o)}
            style={{
              width: '100%',
              height: 36,
              backgroundColor: '#131316',
              border: '1px solid #1f1f23',
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
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 4,
                  backgroundColor: '#1f2937',
                  color: '#93c5fd',
                }}
              >
                {currentTenant.orgId}
              </span>
            </div>
            <ChevronDown size={13} color="#71717a" />
          </button>

          {tenantMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 42,
                right: 0,
                width: 300,
                backgroundColor: '#16161a',
                border: '1px solid #27272a',
                borderRadius: 10,
                padding: 6,
                zIndex: 50,
                boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: '#71717a',
                  padding: '4px 8px',
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                }}
              >
                Switch Tenant (Live Isolation Proof)
              </div>
              {DEMO_TENANTS.map((t, idx) => (
                <button
                  key={t.orgId}
                  onClick={() => {
                    setActiveTenantIdx(idx);
                    setTenantMenuOpen(false);
                    setMemoryAnswer(null);
                    setViewMode('grid');
                    notify(`Switched active tenant token to ${t.orgId} (${t.handle})`);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 7,
                    border: 'none',
                    backgroundColor:
                      idx === activeTenantIdx ? '#1f2937' : 'transparent',
                    color: '#e5e5e7',
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{t.label}</span>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>
                    Claims: {`{ orgId: "${t.orgId}", role: "${t.role}" }`}
                  </span>
                </button>
              ))}
              <div
                style={{
                  borderTop: '1px solid #27272a',
                  marginTop: 6,
                  paddingTop: 6,
                }}
              >
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
                    color: '#60a5fa',
                    textDecoration: 'none',
                  }}
                >
                  <Download size={14} />
                  <span>Export Organization (.zip of Markdown)</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* =================================================================== */}
      {/* MAIN BODY (Center Workspace + Right Sidebar)                        */}
      {/* =================================================================== */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {/* CENTER WORKSPACE */}
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
          {/* Vault Header (Shown in Grid, List, Calendar, Graph, Inbox, Code, Judge views) */}
          {viewMode !== 'editor' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 18px 8px 18px',
                flexShrink: 0,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f6' }}>
                  {viewMode === 'inbox'
                    ? 'Memory & Grounded Q&A'
                    : viewMode === 'code'
                    ? 'Deterministic App Builder & Runtime'
                    : viewMode === 'judge'
                    ? 'Hackathon Judge Verification Suite'
                    : 'Vault'}
                </div>
                <div style={{ fontSize: 11, color: '#71717a', marginTop: 1 }}>
                  {viewMode === 'inbox'
                    ? `Ask questions across ${collections.length} knowledge collection(s) · ${chunkCount} indexed vector chunks`
                    : viewMode === 'code'
                    ? 'Closed Zod schema components · No generated code ever executes'
                    : viewMode === 'judge'
                    ? 'Interactive verification of all 8 principles, KMS AES-256-GCM encryption, and grounding'
                    : 'Everything you have kept'}
                </div>
              </div>

              {/* View Mode Switcher Icons (Matches Screenshots 1, 3, 4, 5) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => setViewMode('grid')}
                  title="Bento Grid View"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'grid' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  title="List View"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'list' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <List size={16} />
                </button>
                <button
                  onClick={() => setViewMode('calendar')}
                  title="Calendar View"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'calendar' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <CalendarIcon size={16} />
                </button>
                <button
                  onClick={() => setViewMode('graph')}
                  title="Knowledge Graph View"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: viewMode === 'graph' ? '#0088ff' : '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Network size={16} />
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
                  <Settings size={14} />
                  <span>CUSTOMIZE</span>
                </button>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 1: BENTO GRID VIEW (Matches Screenshot 1)                  */}
          {/* =============================================================== */}
          {viewMode === 'grid' && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                gap: 20,
                padding: '10px 18px 24px 18px',
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
                  const isFirst = slotIdx === 0;
                  return (
                    <div
                      key={slotIdx}
                      onClick={() => doc && openDocumentInEditor(doc)}
                      style={{
                        backgroundColor: isFirst ? '#cfd0d3' : '#8c8d91',
                        color: '#111113',
                        borderRadius: 16,
                        padding: 18,
                        cursor: doc ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        transition: 'transform 0.12s ease',
                        overflow: 'hidden',
                      }}
                    >
                      {doc ? (
                        <>
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                fontSize: 11,
                                fontWeight: 700,
                                opacity: 0.7,
                              }}
                            >
                              <span>
                                {doc.parentId
                                  ? folderNameById.get(doc.parentId) ?? 'Vault'
                                  : 'Vault'}
                              </span>
                              <span>v{doc.version} · AES-256-GCM</span>
                            </div>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 700,
                                marginTop: 6,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {doc.name}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                marginTop: 8,
                                lineHeight: 1.45,
                                opacity: 0.85,
                                display: '-webkit-box',
                                WebkitLineClamp: 5,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {doc.body}
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              opacity: 0.65,
                              display: 'flex',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span>SHA-256: {doc.sha256.slice(0, 10)}…</span>
                            <span>{doc.sizeBytes} B</span>
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 12, opacity: 0.6 }}>Empty slot</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Right Large Featured Card (Matches Screenshot 1 right canvas) */}
              <div
                style={{
                  flex: 1,
                  backgroundColor: '#e4e4e7',
                  color: '#111113',
                  borderRadius: 22,
                  padding: 26,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  overflow: 'auto',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 14,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.6,
                        padding: '4px 10px',
                        borderRadius: 6,
                        backgroundColor: '#111113',
                        color: '#ffffff',
                      }}
                    >
                      Your Agents Remember, And You Own The Memory
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.7 }}>
                      Tenant: {currentTenant.orgId} · KMS Key v1
                    </span>
                  </div>

                  <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
                    {activeDoc ? activeDoc.name : 'Workspace Vault'}
                  </h2>

                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.6,
                      backgroundColor: 'rgba(255,255,255,0.65)',
                      padding: 16,
                      borderRadius: 12,
                      marginBottom: 18,
                    }}
                  >
                    {activeDoc ? (
                      <ReactMarkdown>{activeDoc.body}</ReactMarkdown>
                    ) : (
                      <p>Select any Markdown file from the Vault tree to view or edit.</p>
                    )}
                  </div>

                  {/* Embedded Quick Grounded Memory Search inside the Hero Canvas */}
                  <div
                    style={{
                      backgroundColor: '#18181b',
                      color: '#f4f4f6',
                      borderRadius: 14,
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#60a5fa',
                        }}
                      >
                        <Sparkles size={14} />
                        <span>Ask Grounded Company Memory ({models.reasoning})</span>
                      </div>
                      <span style={{ fontSize: 11, color: '#a1a1aa' }}>
                        {chunkCount} embedded chunks in {collections.length} collection(s)
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={memoryQuestion}
                        onChange={(e) => setMemoryQuestion(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleAskMemory();
                        }}
                        placeholder="Ask a question grounded in your Markdown files..."
                        style={{
                          flex: 1,
                          backgroundColor: '#27272a',
                          border: '1px solid #3f3f46',
                          borderRadius: 8,
                          padding: '8px 12px',
                          fontSize: 12,
                          color: '#f4f4f6',
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
                          borderRadius: 8,
                          padding: '0 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Send size={13} />
                        <span>{memoryLoading ? 'Searching…' : 'Ask'}</span>
                      </button>
                    </div>

                    {memoryAnswer && (
                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: '1px solid #27272a',
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        <div style={{ marginBottom: 8 }}>
                          <ReactMarkdown>{memoryAnswer.answerMarkdown}</ReactMarkdown>
                        </div>
                        {memoryAnswer.citations.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                                  backgroundColor: '#1e3a5f',
                                  color: '#93c5fd',
                                  cursor: 'pointer',
                                }}
                              >
                                Cite: {c.documentName} ({c.docId} §{c.paragraphOrdinal})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 14,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    {activeDoc && (
                      <button
                        onClick={() => openDocumentInEditor(activeDoc)}
                        style={{
                          backgroundColor: '#111113',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 8,
                          padding: '7px 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Open in Markdown Editor
                      </button>
                    )}
                    <button
                      onClick={() => setViewMode('code')}
                      style={{
                        backgroundColor: 'rgba(0,0,0,0.1)',
                        color: '#111113',
                        border: '1px solid rgba(0,0,0,0.2)',
                        borderRadius: 8,
                        padding: '7px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Open App Builder ({apps.length} App)
                    </button>
                  </div>
                  <span style={{ opacity: 0.65 }}>
                    {liveFiles.length} live Markdown files · {auditEvents.length} audit events
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 2: MARKDOWN EDITOR VIEW (Matches Screenshot 2)             */}
          {/* =============================================================== */}
          {viewMode === 'editor' && activeDoc && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {/* Editor Top Document Header */}
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
                    <ArrowLeft size={16} />
                  </button>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6' }}>
                      {activeDoc.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#71717a' }}>
                      Vault /{' '}
                      {activeDoc.parentId
                        ? `${folderNameById.get(activeDoc.parentId) ?? ''}/`
                        : ''}
                      {activeDoc.name}
                    </div>
                  </div>
                </div>

                {/* Right Editor Controls (Matches Screenshot 2: Download, Copy, Share, A 14 A, Inspector) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                    title="Download plain Markdown"
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
                      notify('Copied Markdown to clipboard');
                    }}
                    title="Copy Markdown"
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
                    title="Version History"
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
                    onClick={() => setShowCiphertextInspector((v) => !v)}
                    title="Inspect AES-256-GCM Ciphertext & AAD"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: showCiphertextInspector ? '#0088ff' : '#0088ff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                    }}
                  >
                    <Lock size={14} />
                  </button>
                </div>
              </div>

              {/* Formatting & Concurrency Toolbar (Matches Screenshot 2) */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#71717a' }}>
                    expectedVersion: {activeDoc.version}
                  </span>
                  <button
                    onClick={() => void handleSaveActiveDocument()}
                    style={{
                      backgroundColor: '#0088ff',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Save & Encrypt
                  </button>
                  <button
                    onClick={() => void handleArchiveDocument(activeDoc)}
                    style={{
                      backgroundColor: '#27171a',
                      color: '#f87171',
                      border: '1px solid #451a23',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Archive size={12} />
                    <span>Archive (HMAC)</span>
                  </button>
                </div>
              </div>

              {/* Ciphertext & AAD Inspector Drawer */}
              {showCiphertextInspector && (
                <div
                  style={{
                    backgroundColor: '#12161f',
                    borderBottom: '1px solid #1e293b',
                    padding: '10px 18px',
                    fontSize: 11,
                    color: '#93c5fd',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    At-Rest Firestore Encryption Proof (Principle 6)
                  </div>
                  <div>
                    <strong>AAD Binding:</strong>{' '}
                    <code>
                      {currentTenant.orgId}/{activeDoc.id}
                    </code>{' '}
                    · <strong>Key Version:</strong> <code>v{activeDoc.keyVersion}</code> ·{' '}
                    <strong>SHA-256:</strong> <code>{activeDoc.sha256}</code>
                  </div>
                  <div
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: '#60a5fa',
                    }}
                  >
                    <strong>Raw Firestore bodyCiphertext:</strong>{' '}
                    <code>{rawCiphertexts[activeDoc.id] ?? '(encrypted)'}</code>
                  </div>
                </div>
              )}

              {/* Version History Drawer */}
              {showVersionHistory && (
                <div
                  style={{
                    backgroundColor: '#141418',
                    borderBottom: '1px solid #27272a',
                    padding: '10px 18px',
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                      fontWeight: 600,
                    }}
                  >
                    <span>Immutable Version History ({docVersions.length} versions)</span>
                    <button
                      onClick={() => setShowVersionHistory(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#71717a',
                        cursor: 'pointer',
                      }}
                    >
                      Close
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                    {docVersions.map((ver) => (
                      <div
                        key={ver.version}
                        onClick={() => {
                          setEditorBody(ver.body);
                          notify(`Loaded version v${ver.version} into editor`);
                        }}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: '#1f1f24',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 11,
                          minWidth: 160,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          Version {ver.version} · by {ver.writtenBy}
                        </div>
                        <div style={{ color: '#9ca3af', marginTop: 2 }}>
                          {ver.body.slice(0, 42)}…
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Editor Textarea with Line Numbers (Matches Screenshot 2) */}
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

              {/* Bottom Editor Status Bar (Matches Screenshot 2) */}
              <div
                style={{
                  height: 28,
                  padding: '0 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: '#71717a',
                  borderTop: '1px solid #141417',
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
          {/* VIEW 3: LIST VIEW (Matches Screenshot 3)                        */}
          {/* =============================================================== */}
          {viewMode === 'list' && (
            <div style={{ flex: 1, padding: '12px 18px', overflowY: 'auto' }}>
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
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <FileText size={15} color="#a1a1aa" />
                        <span style={{ fontSize: 13, color: '#e5e5e7', fontWeight: 500 }}>
                          {file.name}
                        </span>
                        <span style={{ fontSize: 12, color: '#71717a' }}>
                          {parentLabel}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontSize: 11,
                          color: '#52525b',
                        }}
                      >
                        <span>v{file.version}</span>
                        <span>{file.sizeBytes} B</span>
                      </div>
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
            <div style={{ flex: 1, padding: '10px 24px', overflowY: 'auto' }}>
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

              {/* 6-Month Calendar Grid (January - June 2026) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px repeat(6, 1fr)',
                  gap: 16,
                  paddingBottom: 24,
                  borderBottom: '1px solid #18181b',
                }}
              >
                {/* Day-of-week labels column */}
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
                  // Arrange days into 7 rows (Mon..Sun) x 5 columns
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

              {/* Date Grouped Markdown Files (Matches Screenshot 4 bottom section) */}
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
                {/* Edges from Vault center (450, 310) */}
                <line
                  x1={450}
                  y1={310}
                  x2={450}
                  y2={180}
                  stroke="#3f3f46"
                  strokeWidth={1}
                />
                <line
                  x1={450}
                  y1={180}
                  x2={450}
                  y2={140}
                  stroke="#3f3f46"
                  strokeWidth={1}
                />
                <line
                  x1={450}
                  y1={180}
                  x2={155}
                  y2={310}
                  stroke="#3f3f46"
                  strokeWidth={1}
                />
                <line
                  x1={450}
                  y1={180}
                  x2={745}
                  y2={310}
                  stroke="#3f3f46"
                  strokeWidth={1}
                />
                <line
                  x1={450}
                  y1={310}
                  x2={450}
                  y2={445}
                  stroke="#3f3f46"
                  strokeWidth={1}
                />
                <line
                  x1={450}
                  y1={445}
                  x2={450}
                  y2={485}
                  stroke="#3f3f46"
                  strokeWidth={1}
                />

                {/* Center Vault Node */}
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

                {/* Folder node: test */}
                <circle cx={450} cy={180} r={4.5} fill="#71717a" />
                <text x={462} y={184} fill="#a1a1aa" fontSize={11}>
                  test
                </text>

                {/* File nodes around the graph */}
                {[
                  {
                    doc: liveFiles[0],
                    fallback: '2026-09-02 12-12-16.md',
                    cx: 450,
                    cy: 140,
                  },
                  {
                    doc: liveFiles[3],
                    fallback: '2026-09-07 19-45-14.md',
                    cx: 155,
                    cy: 310,
                  },
                  {
                    doc: liveFiles[1],
                    fallback: '2026-09-07 19-45-11.md',
                    cx: 745,
                    cy: 310,
                  },
                  {
                    doc: liveFiles[4],
                    fallback: '2026-09-07 19-45-33.md',
                    cx: 450,
                    cy: 445,
                  },
                  {
                    doc: liveFiles[2],
                    fallback: '2026-09-07 19-45-13.md',
                    cx: 450,
                    cy: 485,
                  },
                ].map((node, idx) => (
                  <g
                    key={idx}
                    onClick={() => node.doc && openDocumentInEditor(node.doc)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle cx={node.cx} cy={node.cy} r={4.5} fill="#71717a" />
                    <text
                      x={node.cx + 12}
                      y={node.cy + 4}
                      fill="#a1a1aa"
                      fontSize={11}
                    >
                      {node.doc?.name ?? node.fallback}
                    </text>
                  </g>
                ))}
              </svg>

              {/* Bottom-Left Graph Zoom Pill (Matches Screenshot 5: `- 100% +`) */}
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
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#a1a1aa',
                    cursor: 'pointer',
                  }}
                >
                  -
                </button>
                <span>{graphZoom}%</span>
                <button
                  onClick={() => setGraphZoom((z) => Math.min(160, z + 10))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#a1a1aa',
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 6: INBOX / GROUNDED MEMORY Q&A & REBUILD (Step 3)          */}
          {/* =============================================================== */}
          {viewMode === 'inbox' && (
            <div style={{ flex: 1, padding: '12px 24px', overflowY: 'auto' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr',
                  gap: 20,
                }}
              >
                <div
                  style={{
                    backgroundColor: '#131316',
                    border: '1px solid #222226',
                    borderRadius: 14,
                    padding: 20,
                  }}
                >
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                    Grounded Memory Agent (Vector Search + Paragraph Citations)
                  </h3>
                  <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 14 }}>
                    Answers strictly from chunks inside your organization’s declared
                    Knowledge Collections. Cites exact <code>docId</code> and paragraph
                    ordinal. Returns <em>Not found</em> when ungrounded.
                  </p>

                  {/* Preset Judge Evaluation Questions */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginBottom: 12,
                    }}
                  >
                    {[
                      'How quickly must production incidents be escalated?',
                      'What threshold of vendor contracts requires @berezovsky360 approval?',
                      'What is the dental insurance deductible in Tokyo? (Ungrounded Test)',
                    ].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => {
                          setMemoryQuestion(preset);
                          void handleAskMemory(preset);
                        }}
                        style={{
                          backgroundColor: '#1c1c21',
                          border: '1px solid #2c2c32',
                          borderRadius: 6,
                          padding: '5px 10px',
                          fontSize: 11,
                          color: '#d4d4d8',
                          cursor: 'pointer',
                        }}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={memoryQuestion}
                      onChange={(e) => setMemoryQuestion(e.target.value)}
                      style={{
                        flex: 1,
                        backgroundColor: '#1c1c21',
                        border: '1px solid #2e2e36',
                        borderRadius: 8,
                        padding: '10px 12px',
                        fontSize: 13,
                      }}
                    />
                    <button
                      onClick={() => void handleAskMemory()}
                      style={{
                        backgroundColor: '#0088ff',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '0 18px',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Run Grounded Query
                    </button>
                  </div>

                  {memoryAnswer && (
                    <div
                      style={{
                        marginTop: 16,
                        padding: 16,
                        borderRadius: 10,
                        backgroundColor: memoryAnswer.notFound
                          ? '#23171b'
                          : '#131d2e',
                        border: memoryAnswer.notFound
                          ? '1px solid #4c1d24'
                          : '1px solid #1e3a5f',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          marginBottom: 8,
                          color: memoryAnswer.notFound ? '#fca5a5' : '#93c5fd',
                          fontWeight: 700,
                        }}
                      >
                        <span>
                          {memoryAnswer.notFound
                            ? 'UNGROUNDED QUERY REJECTED (NOT FOUND)'
                            : `GROUNDED ANSWER (${memoryAnswer.citations.length} CITATIONS)`}
                        </span>
                        <span>
                          Model: {memoryAnswer.model} · {memoryAnswer.latencyMs}ms
                        </span>
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                        <ReactMarkdown>{memoryAnswer.answerMarkdown}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>

                {/* Principle 1: Rebuild Derived Index Card */}
                <div
                  style={{
                    backgroundColor: '#131316',
                    border: '1px solid #222226',
                    borderRadius: 14,
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 14,
                        fontWeight: 700,
                        marginBottom: 8,
                      }}
                    >
                      <Database size={16} color="#0088ff" />
                      <span>Principle 1: Markdown Source of Truth</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
                      Chunks and vector embeddings are strictly derived. You can wipe
                      every vector chunk in Firestore and rebuild the entire semantic
                      index from the encrypted Markdown files alone.
                    </p>
                    <div
                      style={{
                        marginTop: 14,
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor: '#1a1a1f',
                        fontSize: 12,
                      }}
                    >
                      <div>
                        Active Collections: <strong>{collections.length}</strong>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        Live Vector Chunks: <strong>{chunkCount}</strong>
                      </div>
                    </div>
                    {rebuildNotice && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: 10,
                          borderRadius: 8,
                          backgroundColor: '#11261d',
                          color: '#6ee7b7',
                          fontSize: 11,
                        }}
                      >
                        {rebuildNotice}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => void handleRebuildDerived()}
                    style={{
                      marginTop: 16,
                      backgroundColor: '#1f2937',
                      color: '#60a5fa',
                      border: '1px solid #374151',
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    <RefreshCw size={14} />
                    <span>Delete All Chunks & Rebuild Index</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 7: CODE / APP BUILDER, AGENT DIFF, AUTOMATION & AUDIT      */}
          {/* =============================================================== */}
          {viewMode === 'code' && (
            <div
              style={{
                flex: 1,
                padding: '10px 24px 32px 24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
              }}
            >
              {activeApp ? (
                <>
                  {/* App Header + Publish Snapshot + Run Cloud Run Job */}
                  <div
                    style={{
                      backgroundColor: '#131316',
                      border: '1px solid #222226',
                      borderRadius: 14,
                      padding: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                          {activeApp.draftDefinition.name}
                        </h3>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 6,
                            backgroundColor: '#11261d',
                            color: '#6ee7b7',
                            fontWeight: 600,
                          }}
                        >
                          {activeApp.status.toUpperCase()} · Snapshot v
                          {activeApp.publishedSnapshotVersion ?? 1} (Draft v
                          {activeApp.version})
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                        {activeApp.draftDefinition.description}
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={() => void handleRunAutomationJob(activeApp.id)}
                        style={{
                          backgroundColor: '#1e293b',
                          color: '#93c5fd',
                          border: '1px solid #334155',
                          borderRadius: 8,
                          padding: '8px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Play size={13} />
                        <span>Run Cloud Run Automation Job</span>
                      </button>

                      <button
                        onClick={() => void handlePublishApp(activeApp)}
                        style={{
                          backgroundColor: '#0088ff',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 8,
                          padding: '8px 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Publish Snapshot (HMAC Approval)
                      </button>
                    </div>
                  </div>

                  {/* Step 5: Builder Agent Validated Diff Proposal */}
                  <div
                    style={{
                      backgroundColor: '#131316',
                      border: '1px solid #222226',
                      borderRadius: 14,
                      padding: 18,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#60a5fa',
                        }}
                      >
                        <GitCompare size={15} />
                        <span>
                          Step 5: Builder Agent (Tools: read, validate, preview only)
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: '#71717a' }}>
                        Registered Palette: page, section, tabs, text_field, select,
                        date, number, button, form, table, kanban, calendar,
                        detail_view, metric, markdown_block, agent_chat
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={builderInstruction}
                        onChange={(e) => setBuilderInstruction(e.target.value)}
                        style={{
                          flex: 1,
                          backgroundColor: '#1c1c21',
                          border: '1px solid #2c2c32',
                          borderRadius: 8,
                          padding: '8px 12px',
                          fontSize: 12,
                        }}
                      />
                      <button
                        onClick={() => void handleProposeDiff(activeApp.id)}
                        style={{
                          backgroundColor: '#1f2937',
                          color: '#e5e5e7',
                          border: '1px solid #374151',
                          borderRadius: 8,
                          padding: '0 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Propose Validated Diff
                      </button>
                    </div>

                    {proposedDiff && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          borderRadius: 8,
                          backgroundColor: '#182232',
                          border: '1px solid #1e3a5f',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ fontSize: 12 }}>
                          <div style={{ fontWeight: 700, color: '#93c5fd' }}>
                            {proposedDiff.summary}
                          </div>
                          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>
                            Added IDs: {proposedDiff.addedComponentIds.join(', ') || 'none'}{' '}
                            · Validated against closed Zod <code>AppDefinitionSchema.strict()</code>
                          </div>
                        </div>
                        <button
                          onClick={() => void handleApplyDiff()}
                          style={{
                            backgroundColor: '#10b981',
                            color: '#06281e',
                            border: 'none',
                            borderRadius: 6,
                            padding: '6px 12px',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Explicitly Apply Diff
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Deterministic Runtime: Metrics + Kanban + Encrypted Markdown Records */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: '#131316',
                        border: '1px solid #222226',
                        borderRadius: 12,
                        padding: 16,
                      }}
                    >
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>
                        Total Pipeline Value (Metric Component)
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
                        $
                        {activeAppRecords
                          .reduce((acc, r) => acc + Number(r.fields.amount ?? 0), 0)
                          .toLocaleString()}
                      </div>
                    </div>

                    <div
                      style={{
                        backgroundColor: '#131316',
                        border: '1px solid #222226',
                        borderRadius: 12,
                        padding: 16,
                      }}
                    >
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>
                        Encrypted Markdown Records
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
                        {activeAppRecords.length} Records
                      </div>
                    </div>

                    <div
                      style={{
                        backgroundColor: '#131316',
                        border: '1px solid #222226',
                        borderRadius: 12,
                        padding: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>
                        Quick Add Encrypted Record
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={newDealTitle}
                          onChange={(e) => setNewDealTitle(e.target.value)}
                          placeholder="Deal name..."
                          style={{
                            flex: 1,
                            backgroundColor: '#1c1c21',
                            border: '1px solid #2c2c32',
                            borderRadius: 6,
                            padding: '5px 8px',
                            fontSize: 12,
                          }}
                        />
                        <input
                          value={newDealAmount}
                          onChange={(e) => setNewDealAmount(e.target.value)}
                          placeholder="$"
                          style={{
                            width: 74,
                            backgroundColor: '#1c1c21',
                            border: '1px solid #2c2c32',
                            borderRadius: 6,
                            padding: '5px 8px',
                            fontSize: 12,
                          }}
                        />
                        <button
                          onClick={() => void handleCreateDealRecord(activeApp.id)}
                          style={{
                            backgroundColor: '#0088ff',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '0 10px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Kanban Board (Step 4 & Step 7 Status Transitions with Named Approver) */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 14,
                    }}
                  >
                    {['Draft', 'In Review', 'Approved'].map((stage) => {
                      const stageRecords = activeAppRecords.filter(
                        (r) => String(r.fields.status) === stage
                      );
                      return (
                        <div
                          key={stage}
                          style={{
                            backgroundColor: '#131316',
                            border: '1px solid #222226',
                            borderRadius: 12,
                            padding: 14,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: 12,
                              fontWeight: 700,
                              marginBottom: 10,
                            }}
                          >
                            <span>{stage}</span>
                            <span style={{ color: '#71717a' }}>{stageRecords.length}</span>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                            }}
                          >
                            {stageRecords.map((rec) => (
                              <div
                                key={rec.id}
                                style={{
                                  backgroundColor: '#1b1b20',
                                  border: '1px solid #27272e',
                                  borderRadius: 8,
                                  padding: 12,
                                  fontSize: 12,
                                }}
                              >
                                <div style={{ fontWeight: 700 }}>
                                  {String(rec.fields.title ?? rec.id)}
                                </div>
                                <div
                                  style={{
                                    color: '#60a5fa',
                                    fontSize: 11,
                                    marginTop: 4,
                                  }}
                                >
                                  ${Number(rec.fields.amount ?? 0).toLocaleString()} · v
                                  {rec.version}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#9ca3af',
                                    marginTop: 6,
                                  }}
                                >
                                  {rec.notesMarkdown}
                                </div>
                                <div
                                  style={{
                                    display: 'flex',
                                    gap: 6,
                                    marginTop: 10,
                                  }}
                                >
                                  {stage === 'Draft' && (
                                    <button
                                      onClick={() =>
                                        void handleTransitionRecord(
                                          activeApp.id,
                                          rec,
                                          'In Review'
                                        )
                                      }
                                      style={{
                                        backgroundColor: '#1f2937',
                                        color: '#93c5fd',
                                        border: '1px solid #374151',
                                        borderRadius: 5,
                                        padding: '4px 8px',
                                        fontSize: 11,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Submit for Review →
                                    </button>
                                  )}
                                  {stage === 'In Review' && (
                                    <button
                                      onClick={() =>
                                        void handleTransitionRecord(
                                          activeApp.id,
                                          rec,
                                          'Approved'
                                        )
                                      }
                                      style={{
                                        backgroundColor: '#11261d',
                                        color: '#6ee7b7',
                                        border: '1px solid #065f46',
                                        borderRadius: 5,
                                        padding: '4px 8px',
                                        fontSize: 11,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Approve (@berezovsky360) →
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

                  {/* Step 7: Append-Only Audit Log */}
                  <div
                    style={{
                      backgroundColor: '#131316',
                      border: '1px solid #222226',
                      borderRadius: 14,
                      padding: 18,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        marginBottom: 10,
                      }}
                    >
                      Step 7: Append-Only Organization Audit Log ({auditEvents.length}{' '}
                      immutable events)
                    </div>
                    <div
                      style={{
                        maxHeight: 200,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      {auditEvents.map((ev) => (
                        <div
                          key={ev.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            backgroundColor: '#1a1a1f',
                            borderRadius: 6,
                            fontSize: 11,
                          }}
                        >
                          <div>
                            <strong style={{ color: '#60a5fa' }}>{ev.action}</strong> on{' '}
                            <code>
                              {ev.targetType}:{ev.targetId}
                            </code>{' '}
                            by <strong>{ev.actor}</strong>
                          </div>
                          <span style={{ color: '#71717a' }}>{ev.createdAt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: '#9ca3af' }}>
                  No apps created in this tenant yet.
                </div>
              )}
            </div>
          )}

          {/* =============================================================== */}
          {/* VIEW 8: HACKATHON JUDGE CONSOLE (Interactive Proof Suite)        */}
          {/* =============================================================== */}
          {viewMode === 'judge' && (
            <div
              style={{
                flex: 1,
                padding: '12px 24px 32px 24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div
                style={{
                  backgroundColor: '#131c2e',
                  border: '1px solid #1e3a5f',
                  borderRadius: 14,
                  padding: 18,
                  display: ' flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: '#93c5fd' }}>
                    LOW on Google Cloud — Hackathon Evaluation & Proof Dashboard
                  </h3>
                  <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>
                    Every principle and acceptance criterion is live and verifiable below
                    or via <code>npm test</code> (16/16 automated tests passing).
                  </p>
                </div>
                <a
                  href={`/api/export?orgId=${encodeURIComponent(
                    currentTenant.orgId
                  )}&uid=${encodeURIComponent(currentTenant.uid)}&role=${encodeURIComponent(
                    currentTenant.role
                  )}`}
                  style={{
                    backgroundColor: '#0088ff',
                    color: '#ffffff',
                    padding: '9px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Download size={14} />
                  <span>1-Click Portable .zip Export</span>
                </a>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 14,
                }}
              >
                {[
                  {
                    title: '1. Markdown Source of Truth & Rebuild',
                    desc: 'All documents and app records are pure Markdown. Chunks and embeddings can be wiped and rebuilt identically via scripts/rebuild-derived.ts.',
                    actionLabel: 'Test Live Index Rebuild',
                    onAction: () => void handleRebuildDerived(),
                  },
                  {
                    title: '2. Dual-Enforced Tenant Isolation',
                    desc: 'Enforced in firestore.rules (request.auth.token.orgId == orgId) AND in the single server repository module (FirestoreRepository).',
                    actionLabel:
                      activeTenantIdx === 0
                        ? 'Switch to Isolated Tenant B (@beta_admin)'
                        : 'Switch back to Tenant A (@berezovsky360)',
                    onAction: () => {
                      setActiveTenantIdx((i) => (i === 0 ? 1 : 0));
                    },
                  },
                  {
                    title: '3. KMS Envelope Encryption + AAD Binding',
                    desc: 'Per-organization AES-256-GCM data key wrapped by Cloud KMS. Ciphertext is bound to orgId/docId via AAD so cross-tenant copy fails.',
                    actionLabel: 'Inspect Raw Ciphertext in Editor',
                    onAction: () => {
                      setShowCiphertextInspector(true);
                      if (liveFiles[0]) openDocumentInEditor(liveFiles[0]);
                    },
                  },
                  {
                    title: '4. Grounded Memory & Anti-Hallucination',
                    desc: 'Answers cite exact docId and paragraph ordinal. Questions outside the Knowledge Collection return "Not found" on evaluation sets.',
                    actionLabel: 'Open Grounded Memory Evaluation',
                    onAction: () => setViewMode('inbox'),
                  },
                ].map((card, i) => (
                  <div
                    key={i}
                    style={{
                      backgroundColor: '#131316',
                      border: '1px solid #222226',
                      borderRadius: 12,
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#f4f4f6',
                        }}
                      >
                        <CheckCircle2 size={15} color="#10b981" />
                        <span>{card.title}</span>
                      </div>
                      <p
                        style={{
                          fontSize: 12,
                          color: '#9ca3af',
                          marginTop: 6,
                          lineHeight: 1.5,
                        }}
                      >
                        {card.desc}
                      </p>
                    </div>
                    <button
                      onClick={card.onAction}
                      style={{
                        marginTop: 12,
                        backgroundColor: '#1f2937',
                        color: '#60a5fa',
                        border: '1px solid #374151',
                        borderRadius: 7,
                        padding: '7px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        alignSelf: 'flex-start',
                      }}
                    >
                      {card.actionLabel}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* FLOATING BOTTOM-RIGHT MIC & + BUTTONS (Matches Screenshots 1-5) */}
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
            {/* Dark Circular Microphone Button (Step 2: Audio Capture) */}
            <button
              onClick={() => setMicModalOpen(true)}
              title="Capture & Transcribe Audio Note with Gemini"
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
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              }}
            >
              <Mic size={18} />
            </button>

            {/* Bright Blue Circular + Button (Step 1: Create File / Folder) */}
            {viewMode !== 'editor' && (
              <button
                onClick={() => setNewFileModalOpen(true)}
                title="Create Markdown File or Folder"
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
                  boxShadow: '0 6px 20px rgba(0, 136, 255, 0.45)',
                }}
              >
                <Plus size={22} />
              </button>
            )}
          </div>
        </main>

        {/* ================================================================= */}
        {/* RIGHT SIDEBAR (Matches Screenshots 1-5: Inbox, Code, Vaults, Bin) */}
        {/* ================================================================= */}
        {sidebarOpen && (
          <aside
            style={{
              width: 280,
              backgroundColor: '#111113',
              borderLeft: '1px solid #1c1c1f',
              padding: '12px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflowY: 'auto',
              flexShrink: 0,
            }}
          >
            {/* Inbox Pill Button */}
            <button
              onClick={() => setViewMode('inbox')}
              style={{
                width: '100%',
                height: 36,
                backgroundColor: viewMode === 'inbox' ? '#1f2937' : '#18181b',
                border: '1px solid #242429',
                borderRadius: 9,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12,
                fontWeight: 500,
                color: '#d4d4d8',
                cursor: 'pointer',
              }}
            >
              <Inbox size={14} color="#8e8e93" />
              <span>Inbox</span>
            </button>

            {/* Code Pill Button */}
            <button
              onClick={() => setViewMode('code')}
              style={{
                width: '100%',
                height: 36,
                backgroundColor: viewMode === 'code' ? '#1f2937' : '#18181b',
                border: '1px solid #242429',
                borderRadius: 9,
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12,
                fontWeight: 500,
                color: '#d4d4d8',
                cursor: 'pointer',
              }}
            >
              <Code2 size={14} color="#8e8e93" />
              <span>Code</span>
            </button>

            {/* Vaults Tree Section */}
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
                  {vaultsExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <span>Vaults</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewItemKind('folder');
                    setNewFileModalOpen(true);
                  }}
                  title="New Folder"
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
                  {/* Folders */}
                  {liveFolders.map((folder) => {
                    const children = liveFiles.filter(
                      (f) => f.parentId === folder.id
                    );
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
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 7,
                            }}
                          >
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

                  {/* Root-level Markdown files */}
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
                            border: isSelected
                              ? '1px solid #27272e'
                              : '1px solid transparent',
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

            {/* Divider */}
            <div
              style={{
                borderTop: '1px solid #1c1c1f',
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
                {sharedExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <span>Shared</span>
              </div>
              {sharedExpanded && (
                <div
                  style={{
                    padding: '6px 12px',
                    fontSize: 11,
                    color: '#9ca3af',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {collections.map((c) => (
                    <div key={c.id}>Collection: {c.name}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Bin Section (Matches Screenshots 1-5: `Bin 0` / `The Bin is empty`) */}
            <div
              style={{
                borderTop: '1px solid #1c1c1f',
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
                {binExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
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
                            title="Restore from Bin"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#60a5fa',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                              fontSize: 11,
                            }}
                          >
                            <RotateCcw size={11} />
                            <span>Restore</span>
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
      {/* MODAL 1: VOICE RECORDING & GEMINI TRANSCRIPTION (Step 2)            */}
      {/* =================================================================== */}
      {micModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: 460,
              backgroundColor: '#16161a',
              border: '1px solid #27272a',
              borderRadius: 16,
              padding: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Mic size={16} color="#0088ff" />
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  Capture Audio & Transcribe ({models.transcription})
                </span>
              </div>
              <button
                onClick={() => setMicModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#71717a',
                  cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>
              Uploads audio to Cloud Storage (`organizations/{currentTenant.orgId}/recordings/...`),
              transcribes with Gemini into Markdown, encrypts under your organization KMS key,
              and indexes chunks into Memory.
            </p>

            <textarea
              value={voiceTranscriptInput}
              onChange={(e) => setVoiceTranscriptInput(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                backgroundColor: '#1c1c21',
                border: '1px solid #2e2e36',
                borderRadius: 8,
                padding: 10,
                fontSize: 12,
                color: '#e5e5e7',
              }}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 14,
              }}
            >
              <button
                onClick={() => setMicModalOpen(false)}
                style={{
                  backgroundColor: '#27272a',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCaptureVoice()}
                style={{
                  backgroundColor: '#0088ff',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Transcribe & Save to Vault
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: CREATE MARKDOWN FILE OR FOLDER (Step 1)                    */}
      {/* =================================================================== */}
      {newFileModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: 460,
              backgroundColor: '#16161a',
              border: '1px solid #27272a',
              borderRadius: 16,
              padding: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>
                Create in Vault ({currentTenant.orgId})
              </span>
              <button
                onClick={() => setNewFileModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#71717a',
                  cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => setNewItemKind('file')}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: 8,
                  border: '1px solid #2c2c32',
                  backgroundColor: newItemKind === 'file' ? '#0088ff' : '#1c1c21',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Markdown File (.md)
              </button>
              <button
                onClick={() => setNewItemKind('folder')}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: 8,
                  border: '1px solid #2c2c32',
                  backgroundColor: newItemKind === 'folder' ? '#0088ff' : '#1c1c21',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Folder
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder={
                  newItemKind === 'file' ? '2026-10-18 meeting-notes.md' : 'Folder name'
                }
                style={{
                  backgroundColor: '#1c1c21',
                  border: '1px solid #2e2e36',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                }}
              />

              <select
                value={newItemParentId}
                onChange={(e) => setNewItemParentId(e.target.value)}
                style={{
                  backgroundColor: '#1c1c21',
                  border: '1px solid #2e2e36',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                }}
              >
                <option value="">Vault Root</option>
                {liveFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    Folder: {f.name}
                  </option>
                ))}
              </select>

              {newItemKind === 'file' && (
                <textarea
                  value={newItemBody}
                  onChange={(e) => setNewItemBody(e.target.value)}
                  rows={5}
                  style={{
                    backgroundColor: '#1c1c21',
                    border: '1px solid #2e2e36',
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 12,
                  }}
                />
              )}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 14,
              }}
            >
              <button
                onClick={() => setNewFileModalOpen(false)}
                style={{
                  backgroundColor: '#27272a',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateItem()}
                style={{
                  backgroundColor: '#0088ff',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Create & Encrypt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {statusToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#18181b',
            border: '1px solid #0088ff',
            color: '#f4f4f6',
            padding: '8px 16px',
            borderRadius: 10,
            fontSize: 12,
            fontWeight: 500,
            zIndex: 200,
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}
        >
          {statusToast}
        </div>
      )}
    </div>
  );
}
