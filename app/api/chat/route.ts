import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

import { getApps, initializeApp } from "firebase/app";
import { getBytes, getStorage, list, ref } from "firebase/storage";

import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";

/**
 * .env: CHAT_AI_PROVIDER=claude → Claude
 *       CHAT_AI_PROVIDER=openai → OpenAI (GPT-4o)
 *       그 외(기본값)           → Gemini (무료 티어)
 */
const PROVIDER =
  process.env.CHAT_AI_PROVIDER === "claude"
    ? "claude"
    : process.env.CHAT_AI_PROVIDER === "openai"
      ? "openai"
      : process.env.CHAT_AI_PROVIDER === "local"
        ? "local"
        : "gemini";

const anthropic = PROVIDER === "claude" ? new Anthropic() : null;
const openai =
  PROVIDER === "openai"
    ? new OpenAI()
    : PROVIDER === "local"
      ? new OpenAI({ baseURL: "http://localhost:11434/v1", apiKey: "ollama" })
      : null;
const gemini =
  PROVIDER === "gemini"
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "")
    : null;

// ─── Tool calling (local/openai provider) ────────────────────────────────────

/** 로컬/Ollama: 일부 모델(gemma 등)은 tools 미지원 → 400. env 또는 모델명으로 끔. */
function localLlmSupportsTools(model: string): boolean {
  const env = process.env.LOCAL_LLM_SUPPORTS_TOOLS?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "no" || env === "off") {
    return false;
  }
  if (env === "1" || env === "true" || env === "yes" || env === "on") {
    return true;
  }
  const m = model.toLowerCase();
  if (m.includes("gemma")) return false;
  return true;
}

const CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "Firebase Storage에서 모든 앱버전과 CSV 파일 목록을 조회합니다. 어떤 파일이 있는지 확인할 때 사용하세요.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_csv",
      description:
        "특정 CSV 파일의 내용을 읽습니다. 반드시 list_files를 먼저 호출해 정확한 fullPath를 확인한 후 사용하세요. 경로를 추측하면 오류가 납니다.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "파일 경로 (예: 1.0/Hero{3}.csv)",
          },
        },
        required: ["path"],
      },
    },
  },
];

function getChatStorage() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  const app = getApps()[0] ?? initializeApp(config);
  return getStorage(app);
}

async function executeTool(
  name: string,
  args: Record<string, string>
): Promise<string> {
  const storage = getChatStorage();

  if (name === "list_files") {
    const rootRef = ref(storage);
    const result = await list(rootRef, { maxResults: 1000 });
    const folders: Record<string, string[]> = {};
    for (const prefixRef of result.prefixes) {
      const folderPath = prefixRef.fullPath;
      const folderResult = await list(prefixRef, { maxResults: 500 });
      folders[folderPath] = folderResult.items.map((item) => item.fullPath);
    }
    return JSON.stringify(folders, null, 2);
  }

  if (name === "read_csv") {
    const path = args.path;
    if (!path) return "경로가 필요합니다.";
    try {
      const fileRef = ref(storage, path);
      const bytes = await getBytes(fileRef);
      const text = new TextDecoder("utf-8").decode(bytes);
      const lines = text.split("\n");
      const preview = lines.slice(0, 101).join("\n");
      return lines.length > 101
        ? `${preview}\n... (총 ${lines.length}행, 처음 100행만 표시)`
        : preview;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `파일 읽기 실패 (${path}): ${msg}`;
    }
  }

  return "알 수 없는 툴입니다.";
}

// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You must always respond in Korean only. Never use English, Chinese, Thai, or any other language. This is absolute.

# 역할
너는 질리언게임즈 툴 도우미다. 이 툴의 사용법과 기능에 관한 질문에만 답한다.
툴과 무관한 질문(잡담, 날씨, 감정 상담 등)에는 "저는 툴 사용법 안내만 도와드릴 수 있어요. 툴 관련 질문이 있으시면 말씀해 주세요!"라고만 답한다.

# 언어 규칙
- 반드시 한국어로만 답한다.
- 영어, 중국어, 태국어 등 어떤 외국어도 한 글자도 사용하지 않는다.

# 파일 조회 규칙 (반드시 준수)
사용자가 파일 내용, 열 구성, 데이터를 물어보면 사용자에게 되묻지 말고 즉시 아래 순서를 실행한다:
1. list_files 호출 → 실제 존재하는 fullPath 확인
2. 확인된 정확한 fullPath로 즉시 read_csv 호출
3. 읽은 CSV 내용을 바탕으로 열 구성과 데이터를 한국어로 설명

절대 경로를 추측하거나 지어내지 않는다. list_files 없이 read_csv를 호출하지 않는다.
"파일을 읽을까요?" 같은 불필요한 확인 질문을 하지 않는다. 바로 실행한다.

사용자가 파일 간 참조 관계, 의존성을 물어보면 추측하거나 지어내지 말고 다음과 같이 답한다:
"파일 간 참조 관계는 이 툴에서 자동으로 파악하기 어렵습니다. CSV 파일 구조상 명시적인 참조 정보가 없어 정확한 의존 관계를 알려드리기 힘들어요."

# 내부 구현 노출 금지
- 스토리지 경로(0/, 1.0/ 등) 절대 언급 금지. 대신 "디폴트 앱버전", "1.0 앱버전"처럼 표현한다.
- 파일명의 버전 번호({1}, {3} 등) 절대 노출 금지. "Hero{1}.csv" → "Hero" 또는 "Hero.csv"로만 표시한다.

# 용어
- 사용자가 "폴더"라고 하면 "앱버전"을 의미한다.

## 툴 개요
게임 스펙 CSV 파일을 관리하는 어드민 도구입니다.

## 질리언게임즈 소개
- 2022년 9월 창업한 게임 개발사
- 회사명 'zillion'은 "헤아릴 수 없이 많은 수"를 의미하며, 무수한 사용자들에게 즐거움을 주겠다는 비전에서 유래
- 공동대표: 선주호 대표님(기획), 이정훈 대표님(클라이언트 프로그래머)
- 두 대표님은 이전 회사에서 함께 〈테일드 데몬 슬레이어〉를 개발한 인연으로 창업
- 대표 게임: 〈픽셀 헌터 키우기〉 (2023년 3월 출시, 방치형 RPG, Google Play · App Store 서비스 중)
- "생각하는 재미와 보는 맛이 있는 게임"을 지향하며, 화려한 전투 화면과 스킬 이펙트가 특징
- 게임에서 가치를 느끼는 사용자가 기꺼이 시간과 돈을 쓰는 경험을 만드는 것이 목표

## 툴 제작자
이 툴은 질리언게임즈의 최철진 님이 만들었습니다. 푸바오를 좋아하고, 그래픽스를 공부하며, 어려운 것에 일부러 부딪혀보는 도전 정신을 가진 분입니다. 이정훈 대표님께 항상 감사한 마음을 갖고 회사와 함께 성장하기 위해 열심히 노력 중입니다. 여자친구 가은이를 항상 고마워합니다. 좋아하는 음식은 엄마가 해준 애호박볶음입니다.
질리언게임즈의 대표님은 이정훈 대표님과 선주호 대표님입니다.

## 앱버전 구조 (기능 관점)
- 디폴트 앱버전: 앱 버전 무관 공통 스펙. 모든 버전에 기본 적용됩니다.
- 앱버전: 특정 앱 버전 전용 스펙. 디폴트보다 우선 적용됩니다.
- Live 앱버전: 업데이트되는 차트의 기준이 되는 앱버전입니다. 모든 앱버전의 기준점 역할을 합니다.

## 파일 버전 규칙
- 버전 번호는 항상 이전 번호보다 1 큰 숫자로 올려야 합니다. (예: 3 다음은 4)
- 번호를 건너뛰면 이후 파일이 감지되지 않을 수 있으니 반드시 순서대로 올려야 합니다.

## 주요 기능

### 업로드
- 파일을 드래그하거나 클릭해서 선택
- "새 버전": 다음 버전 번호로 자동 업로드
- "덮어쓰기": 특정 기존 버전을 교체
- 같은 이름 파일이 이미 있으면 노란색 경고 표시

### 삭제
- 파일 체크박스 선택 후 삭제 버튼 클릭
- 여러 파일 동시 선택 가능

### 이동
- 파일 선택 후 이동 버튼 클릭
- 같은 앱버전 내 이동 불가, 목적지 앱버전에 같은 파일이 있으면 충돌 알림

### 디폴트로 병합
- 앱버전의 모든 파일을 디폴트 앱버전으로 이동
- 더 이상 특정 앱 버전에만 한정되지 않고, 모든 버전의 공통 기본값이 되어야 할 때 사용
- 충돌 시 디폴트 앱버전의 기존 파일은 새 파일로 교체됨
- 실행 전 충돌 목록 확인 다이얼로그 표시

### Live 앱버전 변경
- 사이드바에서 앱버전 선택 후 "Live로 설정"
- 차트 업데이트의 기준이 되는 앱버전을 지정
- ⚠️ **위험한 작업**: Live 앱버전은 모든 차트 업데이트의 기준점이 되므로, 잘못 변경하면 전체 스펙에 영향을 줄 수 있습니다. 반드시 앱버전 내 파일을 꼼꼼히 확인한 후 신중하게 진행하세요.
- Live 앱버전 변경에 관한 질문에는 항상 이 위험성을 먼저 안내하세요.

### CSV 미리보기
- 파일 클릭 시 내용 미리보기

### 메모
- 파일별 메모 작성 가능

### 앱버전 상세정보
- 앱버전 이름 옆 아이콘 클릭 시 확인 가능
- 제공 항목:
  - **표시명**: 앱버전에 설정된 사용자 친화적 이름
  - **파일 수**: 해당 앱버전에 있는 파일 개수
  - **라이브 여부**: 현재 Live 앱버전인지 표시 (LIVE 표시)

## 주의사항
- 작업(이동/삭제/병합) 중 새로고침하면 데이터 불일치가 생길 수 있습니다.
- 버전 번호는 건너뛰지 마세요.
- **행이 새로 추가된 차트는 반드시 새 앱버전에 등록해야 합니다.** 기존 차트에 새 행이 추가된 경우, 해당 차트를 Live 앱버전에 직접 병합하면 이전 버전 클라이언트들이 새 행 기준으로 데이터를 로드하지 못할 수 있습니다. 새 행이 추가된 차트는 반드시 새 앱버전을 만들어 거기에 등록하세요.

질문이 한국어면 한국어로, 영어면 영어로 답하세요.`;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      messages: { role: "user" | "assistant"; content: string }[];
    };

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          if (!body.messages.length) throw new Error("messages is empty");
          if (PROVIDER === "gemini" && gemini) {
            const model = gemini.getGenerativeModel({
              model: "gemini-2.5-flash",
              systemInstruction: SYSTEM_PROMPT,
            });
            const history = body.messages.slice(0, -1).map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            }));
            const lastMessage = body.messages[body.messages.length - 1].content;
            const chat = model.startChat({ history });
            const result = await chat.sendMessageStream(lastMessage);
            for await (const chunk of result.stream) {
              const text = chunk.text();
              if (text) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
                );
              }
            }
          } else if ((PROVIDER === "openai" || PROVIDER === "local") && openai) {
            const model =
              PROVIDER === "local"
                ? (process.env.LOCAL_LLM_MODEL ?? "qwen2.5")
                : "gpt-4o";
            const msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
              [
                { role: "system", content: SYSTEM_PROMPT },
                ...body.messages,
              ];

            const useTools =
              PROVIDER === "openai" ||
              (PROVIDER === "local" && localLlmSupportsTools(model));

            if (!useTools) {
              const finalStream = await openai.chat.completions.create({
                model,
                messages: msgs,
                stream: true,
              });
              for await (const chunk of finalStream) {
                const text = chunk.choices[0]?.delta?.content ?? "";
                if (text) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
                  );
                }
              }
            } else {
              // 툴 호출 루프 (최대 5회)
              let toolsUsed = false;
              let lastContent: string | null = null;

              for (let i = 0; i < 5; i++) {
                const response = await openai.chat.completions.create({
                  model,
                  messages: msgs,
                  tools: CHAT_TOOLS,
                  stream: false,
                });
                const choice = response.choices[0];
                const toolCalls = choice.message.tool_calls;

                if (!toolCalls || toolCalls.length === 0) {
                  lastContent = choice.message.content;
                  break;
                }

                toolsUsed = true;
                msgs.push(choice.message);

                for (const toolCall of toolCalls) {
                  if (toolCall.type !== "function") continue;
                  const fnName = toolCall.function.name;
                  const label =
                    fnName === "list_files"
                      ? "파일 목록 조회 중..."
                      : "파일 읽는 중...";
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ text: `*(${label})*\n\n` })}\n\n`
                    )
                  );
                  let args: Record<string, string> = {};
                  try {
                    args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, string>;
                  } catch {}
                  const result = await executeTool(fnName, args);
                  msgs.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: result,
                  });
                }
              }

              if (toolsUsed) {
                const finalStream = await openai.chat.completions.create({
                  model,
                  messages: msgs,
                  stream: true,
                });
                for await (const chunk of finalStream) {
                  const text = chunk.choices[0]?.delta?.content ?? "";
                  if (text) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
                    );
                  }
                }
              } else if (lastContent) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ text: lastContent })}\n\n`
                  )
                );
              }
            }
          } else if (anthropic) {
            const stream = anthropic.messages.stream({
              model: "claude-opus-4-6",
              max_tokens: 1024,
              system: SYSTEM_PROMPT,
              messages: body.messages,
            });
            for await (const event of stream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ text: event.delta.text })}\n\n`
                  )
                );
              }
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[chat] stream error:", msg);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return jsonStorageError(e);
  }
}
