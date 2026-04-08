import { For, createSignal, type Component } from 'solid-js';
import type { QuestionAnswerState, QuestionState } from '../../shared/models';

type Props = {
  question: QuestionState;
  onAnswer: (requestID: string, answers: QuestionAnswerState) => void;
};

export const QuestionCard: Component<Props> = (props) => {
  const [answers, setAnswers] = createSignal<string[][]>(props.question.questions.map(() => []));

  return (
    <div class="card">
      <div class="card-title">Question</div>
      <For each={props.question.questions}>
        {(item, index) => (
          <div class="question-group">
            <div class="question-header">{item.header}</div>
            <div class="question-body">{item.question}</div>
            <div class="question-options">
              <For each={item.options}>
                {(option) => (
                  <button
                    class="btn btn-secondary"
                    onClick={() => {
                      setAnswers((current) => {
                        const next = current.map((entry) => [...entry]);
                        next[index()] = [option.label];
                        return next;
                      });
                    }}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
      <div class="card-actions">
        <button class="btn btn-primary" onClick={() => props.onAnswer(props.question.id, answers())}>
          Submit
        </button>
      </div>
    </div>
  );
};
