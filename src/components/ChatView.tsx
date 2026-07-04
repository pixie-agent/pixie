import { useLayoutEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "../hooks/useTranslation";
import MessageBubble from "./MessageBubble";
import type { Conversation, PreviewRequest } from "../types";

// Brand mark — same art as the app/README icon.
const iconUrl = new URL("../assets/icon.svg", import.meta.url).href;

interface ChatViewProps {
  conversation: Conversation | null;
  isGenerating: boolean;
  onOpenPreview: (t: PreviewRequest) => void;
  onRespondPermission?: (convId: string, requestId: string, allow: boolean) => void;
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-4 message-enter">
      <div className="bg-[var(--bg-assistant-msg)] rounded-2xl rounded-bl-sm px-5 py-3">
        <div className="flex items-center gap-1.5">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen() {
  const { t } = useTranslation();
  const suggestions = [
    t('chat.suggestions.excel'),
    t('chat.suggestions.report'),
    t('chat.suggestions.login'),
    t('chat.suggestions.news'),
    t('chat.suggestions.translate'),
    t('chat.suggestions.scrape'),
    t('chat.suggestions.polish'),
    t('chat.suggestions.schema'),
  ];
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <img
        src={iconUrl}
        alt={t('app.name')}
        className="w-16 h-16 rounded-2xl mb-6"
      />
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
        {t('app.name')}
      </h2>
      <p className="text-sm text-[var(--text-secondary)] max-w-sm leading-relaxed">
        {t('chat.welcomeDescription')}
      </p>
      <div className="flex flex-wrap justify-center gap-2 mt-8 max-w-md">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            className="px-3 py-1.5 rounded-full text-xs border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            disabled
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatView({ conversation, isGenerating, onOpenPreview, onRespondPermission }: ChatViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  // Previous message count — used to detect when the user sends a new turn.
  const prevCountRef = useRef(0);
  const [showJump, setShowJump] = useState(false);

  // Show a "jump to latest" button only when the user has manually scrolled up.
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJump(distanceFromBottom >= 100);
  }, []);

  // Scroll to the bottom ONLY when a new message is added (i.e. the user just sent
  // a new turn). The assistant's streaming reply NEVER auto-scrolls, so you can
  // scroll freely and read at your own pace while it generates.
  const messageCount = conversation?.messages.length ?? 0;
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (messageCount > prevCountRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    }
    prevCountRef.current = messageCount;
  }, [messageCount]);

  const jumpToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setShowJump(false);
  }, []);

  // No conversation selected
  if (!conversation) {
    return (
      <div className="flex-1 overflow-hidden">
        <WelcomeScreen />
      </div>
    );
  }

  // Empty conversation
  if (conversation.messages.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        <WelcomeScreen />
      </div>
    );
  }

  const lastMessage = conversation.messages[conversation.messages.length - 1];

  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-6"
      >
        <div className="max-w-4xl mx-auto w-full">
          {conversation.messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onOpenPreview={onOpenPreview} onRespondPermission={onRespondPermission} conversationId={conversation.id} />
          ))}

          {/* Show typing indicator when the last message is a user message and we're generating */}
          {isGenerating &&
            lastMessage.role === "user" && (
              <TypingIndicator />
            )}
        </div>
      </div>

      {showJump && (
        <button
          className="jump-to-bottom"
          onClick={jumpToBottom}
          title={t('chat.scrollToLatest')}
          aria-label={t('chat.scrollToLatest')}
          type="button"
        >
          {t('keys.arrowDown')} {t('chat.latest')}
        </button>
      )}
    </div>
  );
}
