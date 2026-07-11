import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
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

const INITIAL_MESSAGE_RENDER_COUNT = 48;
const MESSAGE_RENDER_CHUNK = 80;
const MESSAGE_RENDER_CHUNK_DELAY_MS = 16;

function ComponentLoading({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      <span className="text-xs text-[var(--text-secondary)]">{t("common.loading")}</span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 rounded text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          {t("common.cancel")}
        </button>
      )}
    </div>
  );
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
  const loadTokenRef = useRef(0);
  const latestConversationRef = useRef<Conversation | null>(conversation);
  // Previous message count — used to detect when the user sends a new turn.
  const prevCountRef = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [displayConversation, setDisplayConversation] = useState<Conversation | null>(conversation);
  const [switching, setSwitching] = useState(false);
  const [renderLimit, setRenderLimit] = useState(INITIAL_MESSAGE_RENDER_COUNT);
  const conversationId = conversation?.id ?? null;

  useEffect(() => {
    latestConversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    if (displayConversation?.id === conversationId) return;
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;

    const startTimer = window.setTimeout(() => {
      if (loadTokenRef.current !== token) return;
      setShowJump(false);
      setRenderLimit(INITIAL_MESSAGE_RENDER_COUNT);
      const next = latestConversationRef.current;
      if (!next) {
        setDisplayConversation(null);
        setSwitching(false);
        return;
      }
      setSwitching(true);
      setDisplayConversation(null);
    }, 0);

    const mountTimer = window.setTimeout(() => {
      if (loadTokenRef.current !== token) return;
      setDisplayConversation(latestConversationRef.current);
      setSwitching(false);
    }, 45);

    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(mountTimer);
    };
  }, [conversationId, displayConversation?.id]);

  useEffect(() => {
    if (!conversation || switching || displayConversation?.id !== conversation.id) return;
    const timer = window.setTimeout(() => setDisplayConversation(conversation), 0);
    return () => window.clearTimeout(timer);
  }, [conversation, displayConversation?.id, switching]);

  useEffect(() => {
    if (!displayConversation) return;
    const total = displayConversation.messages.length;
    if (renderLimit >= total) return;
    const token = loadTokenRef.current;
    const timer = window.setTimeout(() => {
      if (loadTokenRef.current !== token) return;
      setRenderLimit((n) => Math.min(total, n + MESSAGE_RENDER_CHUNK));
    }, MESSAGE_RENDER_CHUNK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [displayConversation, renderLimit]);

  const cancelConversationLoad = useCallback(() => {
    loadTokenRef.current += 1;
    setSwitching(false);
  }, []);

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
  const messageCount = displayConversation?.messages.length ?? 0;
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

  const hiddenCount = Math.max(0, (displayConversation?.messages.length ?? 0) - renderLimit);
  const visibleMessages = useMemo(
    () => (displayConversation ? displayConversation.messages.slice(hiddenCount) : []),
    [displayConversation, hiddenCount],
  );

  // No conversation selected
  if (switching) {
    return (
      <div className="flex-1 overflow-hidden">
        <ComponentLoading onCancel={cancelConversationLoad} />
      </div>
    );
  }

  if (!displayConversation) {
    return (
      <div className="flex-1 overflow-hidden">
        <WelcomeScreen />
      </div>
    );
  }

  // Empty conversation
  if (displayConversation.messages.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        <WelcomeScreen />
      </div>
    );
  }

  const lastMessage = displayConversation.messages[displayConversation.messages.length - 1];

  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-6"
      >
        <div className="max-w-4xl mx-auto w-full">
          {hiddenCount > 0 && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-[var(--text-secondary)]">
              <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              {t("common.loading")}
            </div>
          )}

          {visibleMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onOpenPreview={onOpenPreview} onRespondPermission={onRespondPermission} conversationId={displayConversation.id} />
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
