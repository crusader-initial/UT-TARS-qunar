/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { NutJSElectronOperator } from './operator';

export const getSystemPrompt = (
  language: 'zh' | 'en',
) => `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`\`\`
Thought: ...
Action: ...
\`\`\`

## Action Space
${NutJSElectronOperator.MANUAL.ACTION_SPACES.join('\n')}

## Note
- Use ${language === 'zh' ? 'Chinese' : 'English'} in \`Thought\` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`Thought\` part.
- If use type, you should click input box first and then input ur content.

## User Instruction
`;

export const getInstructionSysPrompt = (
  language: 'zh' | 'en',
) => `You are a keyword extractor. You need to extract the key information from the user's instruction.

## Output Format
\`\`\`
# you need open app package:
[
{
 "app_name": "com.ctrip.android",
 "name": "携程"
},
{
  "name": "去哪儿" ,
  "app_name": "com.Qunar"
},
{
 "name": "美团",
 "app_name": "com.meituan.android"
}
]
# Keyword List
1. *checkin date*
2. *checkout date*
3. *hotel name*
4. *city name*
5. keyword1
6. keyword2

\`\`\`

## Note
- Use ${language === 'zh' ? 'Chinese' : 'English'} in \`Thought\` part.
- Use *xx* to wrap the key information must be extracted.if not exist, use empty string.
- if checkin date or checkout date is not specified, use today's date.

`;
