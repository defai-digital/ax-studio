/* eslint-disable react-refresh/only-export-components */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DOMPurify from 'dompurify';
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createHighlighter, type BundledLanguage, type Highlighter, type ShikiTransformer } from "shiki";
import { axStudioLightTheme } from "@/lib/shiki-theme-light";
import { axStudioDarkTheme } from "@/lib/shiki-theme-dark";

// --- Singleton highlighter (shared across all CodeBlock instances) ---
let _highlighterPromise: Promise<Highlighter> | null = null;
const _loadedLangs = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
  if (!_highlighterPromise) {
    _highlighterPromise = createHighlighter({
      themes: [axStudioLightTheme, axStudioDarkTheme],
      langs: [],
    });
  }
  return _highlighterPromise;
}

// --- LRU-style cache bounded to 200 entries ---
const MAX_CACHE_SIZE = 200;
const _htmlCache = new Map<string, [string, string]>();
const _pendingHighlights = new Map<string, Promise<[string, string]>>();

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: BundledLanguage;
  showLineNumbers?: boolean;
};

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
});

const lineNumberTransformer: ShikiTransformer = {
  name: "line-numbers",
  line(node, line) {
    node.children.unshift({
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "inline-block",
          "min-w-10",
          "mr-4",
          "text-right",
          "text-muted-foreground",
        ],
      },
      children: [{ type: "text", value: String(line) }],
    });
  },
};

export async function highlightCode(
  code: string,
  language: BundledLanguage,
  showLineNumbers = false,
): Promise<[string, string]> {
  const cacheKey = `${language}:${showLineNumbers ? "1" : "0"}:${code}`;
  const cached = _htmlCache.get(cacheKey);
  if (cached) return cached;

  // Deduplicate concurrent calls for the same cache key
  const pending = _pendingHighlights.get(cacheKey);
  if (pending) return pending;

  const promise = (async (): Promise<[string, string]> => {
    const transformers: ShikiTransformer[] = showLineNumbers
      ? [lineNumberTransformer]
      : [];

    const hl = await getHighlighter();
    if (!_loadedLangs.has(language)) {
      await hl.loadLanguage(language);
      _loadedLangs.add(language);
    }

    const result: [string, string] = [
      hl.codeToHtml(code, { lang: language, theme: "ax-studio-light", transformers }),
      hl.codeToHtml(code, { lang: language, theme: "ax-studio-dark", transformers }),
    ];

    if (_htmlCache.size >= MAX_CACHE_SIZE) {
      const firstKey = _htmlCache.keys().next().value;
      if (firstKey !== undefined) _htmlCache.delete(firstKey);
    }
    _htmlCache.set(cacheKey, result);
    return result;
  })();

  _pendingHighlights.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    _pendingHighlights.delete(cacheKey);
  }
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [html, setHtml] = useState<string>("");
  const [darkHtml, setDarkHtml] = useState<string>("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    highlightCode(code, language, showLineNumbers)
      .then(([light, dark]) => {
        if (!cancelledRef.current) {
          setHtml(light);
          setDarkHtml(dark);
        }
      })
      .catch((error) => {
        console.error("[CodeBlock] Failed to highlight code:", error);
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [code, language, showLineNumbers]);

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          "group relative w-full overflow-hidden rounded-xl border border-border dark:border-white/6 bg-background dark:bg-[#0d1117]",
          className,
        )}
        {...props}
      >
        <div className="relative">
          <div
            className="overflow-auto dark:hidden [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "sanitized via DOMPurify"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
          />
          <div
            className="hidden overflow-auto dark:block [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-4 [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "sanitized via DOMPurify"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(darkHtml) }}
          />
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const { code } = useContext(CodeBlockContext);

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      onCopy?.();
      setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      onError?.(error as Error);
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  );
};
