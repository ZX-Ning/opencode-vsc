import { For, Show, createEffect, createMemo, createSignal, type Component } from 'solid-js';
import type { QuestionAnswerState, QuestionItemState, QuestionState } from '../../shared/models';

type Props = {
  question: QuestionState;
  onAnswer: (requestID: string, answers: QuestionAnswerState) => void;
};

export const QuestionCard: Component<Props> = (props) => {
  const items = () => props.question.questions;
  const customRefs: Array<HTMLTextAreaElement | undefined> = [];
  const [selectedOptions, setSelectedOptions] = createSignal<string[][]>(items().map(() => []));
  const [customEnabled, setCustomEnabled] = createSignal<boolean[]>(
    items().map((item) => allowsCustom(item) && item.options.length === 0),
  );
  const [customText, setCustomText] = createSignal<string[]>(items().map(() => ''));
  let previousQuestionID = props.question.id;
  let previousQuestionCount = props.question.questions.length;

  const canSubmit = createMemo(() => items().every((_, index) => answersFor(index).length > 0));

  createEffect(() => {
    const nextQuestionID = props.question.id;
    const nextQuestionCount = props.question.questions.length;
    if (nextQuestionID === previousQuestionID && nextQuestionCount === previousQuestionCount) return;

    previousQuestionID = nextQuestionID;
    previousQuestionCount = nextQuestionCount;
    setSelectedOptions(items().map(() => []));
    setCustomEnabled(items().map((item) => allowsCustom(item) && item.options.length === 0));
    setCustomText(items().map(() => ''));
  });

  function allowsCustom(item: QuestionItemState) {
    return item.custom !== false;
  }

  function unique(values: string[]) {
    return [...new Set(values.filter((value) => value.trim()))];
  }

  function answersFor(index: number) {
    const item = items()[index];
    const selected = selectedOptions()[index] ?? [];
    const custom = customEnabled()[index] ? (customText()[index] ?? '').trim() : '';

    if (!item.multiple) {
      if (custom) return [custom];
      return selected.slice(0, 1);
    }

    return unique([...selected, custom]);
  }

  function focusCustom(index: number) {
    requestAnimationFrame(() => customRefs[index]?.focus());
  }

  function toggleOption(questionIndex: number, label: string) {
    const item = items()[questionIndex];
    setSelectedOptions((current) => {
      const next = current.map((entry) => [...entry]);
      const existing = next[questionIndex] ?? [];

      if (item.multiple) {
        next[questionIndex] = existing.includes(label)
          ? existing.filter((value) => value !== label)
          : [...existing, label];
      } else {
        next[questionIndex] = [label];
      }

      return next;
    });

    if (!item.multiple && allowsCustom(item)) {
      setCustomEnabled((current) => {
        const next = [...current];
        next[questionIndex] = false;
        return next;
      });
    }
  }

  function toggleCustom(questionIndex: number) {
    const item = items()[questionIndex];
    if (!allowsCustom(item) || item.options.length === 0) return;

    const nextEnabled = !customEnabled()[questionIndex];
    setCustomEnabled((current) => {
      const next = [...current];
      next[questionIndex] = nextEnabled;
      return next;
    });

    if (!item.multiple && nextEnabled) {
      setSelectedOptions((current) => {
        const next = current.map((entry) => [...entry]);
        next[questionIndex] = [];
        return next;
      });
    }

    if (nextEnabled) {
      focusCustom(questionIndex);
    }
  }

  function setCustomValue(questionIndex: number, value: string) {
    setCustomText((current) => {
      const next = [...current];
      next[questionIndex] = value;
      return next;
    });
  }

  function submit() {
    const answers: QuestionAnswerState = items().map((_, index) => answersFor(index));
    props.onAnswer(props.question.id, answers);
  }

  return (
    <div class="card">
      <div class="card-title">Question</div>
      <For each={items()}>
        {(item, index) => (
          <div class="question-group">
            <div class="question-header">{item.header}</div>
            <div class="question-body">{item.question}</div>
            <div class="question-options">
              <For each={item.options}>
                {(option) => (
                  <button
                    type="button"
                    class="btn btn-secondary question-option"
                    classList={{ 'question-option-selected': (selectedOptions()[index()] ?? []).includes(option.label) }}
                    aria-pressed={(selectedOptions()[index()] ?? []).includes(option.label)}
                    onClick={() => toggleOption(index(), option.label)}
                  >
                    {option.label}
                  </button>
                )}
              </For>

              <Show when={allowsCustom(item) && item.options.length > 0}>
                <button
                  type="button"
                  class="btn btn-secondary question-option"
                  classList={{ 'question-option-selected': customEnabled()[index()] }}
                  aria-pressed={customEnabled()[index()]}
                  onClick={() => toggleCustom(index())}
                >
                  {item.multiple ? 'Add custom' : 'Type answer'}
                </button>
              </Show>
            </div>

            <Show when={allowsCustom(item) && (customEnabled()[index()] || item.options.length === 0)}>
              <div class="question-custom">
                <textarea
                  ref={(el) => {
                    customRefs[index()] = el;
                  }}
                  class="question-custom-input"
                  rows={3}
                  value={customText()[index()]}
                  placeholder={item.multiple ? 'Type a custom answer' : 'Type your answer'}
                  onInput={(event) => setCustomValue(index(), event.currentTarget.value)}
                />
              </div>
            </Show>
          </div>
        )}
      </For>
      <div class="card-actions">
        <button type="button" class="btn btn-primary" disabled={!canSubmit()} onClick={submit}>
          Submit
        </button>
      </div>
    </div>
  );
};
