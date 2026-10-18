'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { Send } from 'lucide-react';

interface SharedAppDef {
  name: string;
  description: string;
  fields: Array<{ key: string; label: string; type: string; options?: string[] }>;
  components: Array<{
    id: string;
    type: string;
    label?: string;
    metricOperation?: 'count' | 'sum' | 'avg';
  }>;
}

interface SharedAppRecord {
  id: string;
  fields: Record<string, string | number | null>;
}

export default function GuestPublishedAppPage() {
  const params = useParams<{ appId: string }>();
  const appId = params?.appId ?? 'app-crm-approvals';

  const [appDef, setAppDef] = useState<SharedAppDef | null>(null);
  const [version, setVersion] = useState<number>(1);
  const [records, setRecords] = useState<SharedAppRecord[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState('100');
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);

  const loadGuestApp = async () => {
    const res = await fetch('/api/low');
    if (!res.ok) return;
    const data = await res.json();
    const found = (data.apps ?? []).find((a: { id: string }) => a.id === appId) ?? data.apps?.[0];
    if (found) {
      setAppDef(found.draftDefinition);
      setVersion(found.publishedSnapshotVersion ?? found.version ?? 1);
      setRecords(data.appRecordsMap?.[found.id] ?? []);
    }
  };

  useEffect(() => {
    void loadGuestApp();
  }, [appId]);

  const handleCreateGuestRecord = async () => {
    if (!newTitle.trim() || !appDef) return;
    const firstStage =
      appDef.fields.find((f) => f.key === 'status')?.options?.[0] ?? 'Draft';
    await fetch('/api/low', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'create_app_record',
        data: {
          appId,
          fields: {
            title: newTitle.trim(),
            status: firstStage,
            amount: Number(newAmount) || 0,
            dueDate: new Date().toISOString().slice(0, 10),
          },
        },
      }),
    });
    setNewTitle('');
    await loadGuestApp();
  };

  const handleAskGuestAgent = async () => {
    if (!chatQuestion.trim()) return;
    const res = await fetch('/api/low', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'ask_memory',
        data: { question: chatQuestion, collectionIds: ['col-vault-test'] },
      }),
    });
    const data = await res.json();
    if (res.ok && data.answer) {
      setChatAnswer(data.answer.answerMarkdown);
    }
  };

  if (!appDef) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#0b0b0c',
          color: '#a1a1aa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        Loading Published App...
      </div>
    );
  }

  const stages =
    appDef.fields.find((f) => f.key === 'status')?.options ?? [
      'Draft',
      'In Review',
      'Approved',
    ];
  const isCurrency = /crm|sales|deal|contract/i.test(appDef.name);
  const sum = records.reduce((a, r) => a + Number(r.fields.amount ?? 0), 0);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0b0b0c',
        color: '#f4f4f6',
        padding: '28px 36px',
        maxWidth: 1120,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #1c1c21',
          paddingBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: '#0088ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            ◡
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{appDef.name}</div>
            <div style={{ fontSize: 11, color: '#71717a' }}>
              Guest Live View · Published Snapshot v{version}
            </div>
          </div>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
        <div
          style={{
            backgroundColor: '#131316',
            border: '1px solid #1f1f24',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 11, color: '#71717a' }}>Total</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
            {isCurrency ? `$${sum.toLocaleString()}` : sum.toLocaleString()}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#131316',
            border: '1px solid #1f1f24',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 11, color: '#71717a' }}>Items</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
            {records.length}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#131316',
            border: '1px solid #1f1f24',
            borderRadius: 12,
            padding: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Submit new entry..."
            style={{
              flex: 1,
              backgroundColor: '#1c1c21',
              border: 'none',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              color: '#f4f4f6',
              outline: 'none',
            }}
          />
          <input
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            style={{
              width: 80,
              backgroundColor: '#1c1c21',
              border: 'none',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              color: '#f4f4f6',
              outline: 'none',
            }}
          />
          <button
            onClick={() => void handleCreateGuestRecord()}
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
            Submit
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
          gap: 12,
        }}
      >
        {stages.map((stage) => {
          const items = records.filter((r) => String(r.fields.status) === stage);
          return (
            <div
              key={stage}
              style={{
                backgroundColor: '#131316',
                border: '1px solid #1f1f24',
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: '#8e8e93',
                  marginBottom: 10,
                }}
              >
                <span>{stage}</span>
                <span>{items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      backgroundColor: '#1a1a1f',
                      borderRadius: 8,
                      padding: 10,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {String(rec.fields.title ?? rec.id)}
                    </div>
                    <div style={{ fontSize: 11, color: '#71717a', marginTop: 4 }}>
                      {isCurrency
                        ? `$${Number(rec.fields.amount ?? 0).toLocaleString()}`
                        : `${Number(rec.fields.amount ?? 0).toLocaleString()} units`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Embedded Agent Chat for Guests */}
      <div
        style={{
          backgroundColor: '#131316',
          border: '1px solid #1f1f24',
          borderRadius: 12,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 11, color: '#8e8e93' }}>Agent Chat</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={chatQuestion}
            onChange={(e) => setChatQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAskGuestAgent();
            }}
            placeholder="Ask app agent..."
            style={{
              flex: 1,
              backgroundColor: '#1c1c21',
              border: 'none',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              color: '#f4f4f6',
              outline: 'none',
            }}
          />
          <button
            onClick={() => void handleAskGuestAgent()}
            style={{
              backgroundColor: '#0088ff',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              padding: '0 14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Send size={13} />
          </button>
        </div>
        {chatAnswer && (
          <div style={{ fontSize: 12, color: '#d4d4d8', lineHeight: 1.5 }}>
            <ReactMarkdown>{chatAnswer}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
