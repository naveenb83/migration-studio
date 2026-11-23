/** Open questions: a small register over question_answer entries. A row counts toward Task 1 while its status is open. */
import { useMemo } from 'react';
import { Register, type Column } from '@/components/register/Register';

export function QuestionsTab({ onChanged }: { onChanged: () => void }) {
  const columns = useMemo<Column[]>(
    () => [
      { key: 'question', label: 'Question', type: 'longtext', width: '320px', placeholder: 'What do you need answered?' },
      { key: 'status', label: 'Status', type: 'select', options: ['open', 'answered'], width: '130px' },
      { key: 'answer', label: 'Answer or next step', type: 'longtext', width: '260px' },
    ],
    [],
  );
  return (
    <Register
      kind="question_answer"
      columns={columns}
      newKey={() => `q-${Date.now().toString(36)}`}
      onChanged={onChanged}
      emptyText="No questions yet. Add one you need answered, and choose its status."
    />
  );
}
