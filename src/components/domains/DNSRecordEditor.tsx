import { useState, useMemo } from 'react';
import type { DNSRecord, DNSRecordType } from '../../types/domain';
import { getEmptyRecord, serializeRecord, deserializeRecord, validateRecord, type ValidationError } from '../../lib/record-helpers';

interface DNSRecordEditorProps {
  records: DNSRecord[];
  onChange: (records: DNSRecord[]) => void;
  readOnly?: boolean;
  errors?: Record<number, ValidationError[]>;
}

export function DNSRecordEditor({ records, onChange, readOnly, errors }: DNSRecordEditorProps) {
  const [newType, setNewType] = useState<DNSRecordType>('NS');
  const [editValues, setEditValues] = useState<Record<number, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addValue, setAddValue] = useState('');

  const visibleErrors = errors || {};

  const handleRemove = (index: number) => {
    onChange(records.filter((_, i) => i !== index));
  };

  const handleTypeChange = (index: number, type: DNSRecordType) => {
    const updated = [...records];
    updated[index] = getEmptyRecord(type);
    onChange(updated);
    setEditValues(prev => ({ ...prev, [index]: '' }));
  };

  const handleEditValue = (index: number, value: string) => {
    setEditValues(prev => ({ ...prev, [index]: value }));
  };

  const handleSaveEdit = (index: number) => {
    const val = editValues[index];
    if (val === undefined) return;
    const record = deserializeRecord(records[index].type, val);
    const updated = [...records];
    updated[index] = record;
    onChange(updated);
    setEditValues(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleAdd = () => {
    if (!addValue.trim()) return;
    const record = deserializeRecord(newType, addValue);
    onChange([...records, record]);
    setAddValue('');
    setShowAdd(false);
  };

  return (
    <div className="space-y-3">
      {records.map((record, index) => {
        const isEditing = editValues[index] !== undefined;
        const rowErrors = visibleErrors[index] || [];
        return (
          <div key={index} className={`flex items-start gap-2 p-3 rounded-lg ${rowErrors.length ? 'bg-red-50 dark:bg-red-900/20 border border-red-300' : 'bg-gray-50 dark:bg-gray-900'}`}>
            <select
              value={record.type}
              onChange={(e) => handleTypeChange(index, e.target.value as DNSRecordType)}
              disabled={readOnly}
              className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm w-24 shrink-0 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="NS">NS</option>
              <option value="GLUE4">GLUE4</option>
              <option value="GLUE6">GLUE6</option>
              <option value="DS">DS</option>
              <option value="TXT">TXT</option>
              <option value="SYNTH4">SYNTH4</option>
              <option value="SYNTH6">SYNTH6</option>
            </select>
            {isEditing ? (
              <div className="flex-1 flex gap-1">
                <input
                  type="text"
                  value={editValues[index]}
                  onChange={(e) => handleEditValue(index, e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm font-mono bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(index); }}
                />
                <button onClick={() => handleSaveEdit(index)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">Save</button>
                <button onClick={() => setEditValues(prev => { const n = { ...prev }; delete n[index]; return n; })} className="px-2 py-1 text-xs bg-gray-400 text-white rounded hover:bg-gray-500">Cancel</button>
              </div>
            ) : (
              <div className="flex-1 flex gap-1">
                <span className="flex-1 px-2 py-1 text-sm font-mono break-all">{serializeRecord(record)}</span>
                {!readOnly && (
                  <>
                    <button onClick={() => setEditValues(prev => ({ ...prev, [index]: serializeRecord(record) }))} className="px-2 py-1 text-xs bg-hns-600 text-white rounded hover:bg-hns-700">Edit</button>
                    <button onClick={() => handleRemove(index)} className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded">✕</button>
                  </>
                )}
              </div>
            )}
            {rowErrors.length > 0 && (
              <div className="text-xs text-red-500 mt-1">
                {rowErrors.map((e, i) => <div key={i}>{e.message}</div>)}
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <div className="flex gap-2 items-center">
          {!showAdd ? (
            <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 text-sm bg-hns-600 text-white rounded-lg hover:bg-hns-700">
              + Add Record
            </button>
          ) : (
            <div className="flex gap-2 items-center flex-1">
              <select value={newType} onChange={(e) => setNewType(e.target.value as DNSRecordType)}
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                <option value="NS">NS</option>
                <option value="GLUE4">GLUE4</option>
                <option value="GLUE6">GLUE6</option>
                <option value="DS">DS</option>
                <option value="TXT">TXT</option>
                <option value="SYNTH4">SYNTH4</option>
                <option value="SYNTH6">SYNTH6</option>
              </select>
              <input type="text" value={addValue} onChange={(e) => setAddValue(e.target.value)}
                placeholder="Value" className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
              <button onClick={handleAdd} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">Add</button>
              <button onClick={() => { setShowAdd(false); setAddValue(''); }} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function useRecordValidation(records: DNSRecord[]): { errors: Record<number, ValidationError[]>; hasErrors: boolean } {
  return useMemo(() => {
    const errors: Record<number, ValidationError[]> = {};
    let hasErrors = false;
    records.forEach((r, i) => {
      const errs = validateRecord(r);
      if (errs.length) {
        errors[i] = errs;
        hasErrors = true;
      }
    });
    return { errors, hasErrors };
  }, [records]);
}
