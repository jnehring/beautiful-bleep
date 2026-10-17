# SPDX-License-Identifier: MIT
"""The LLM judge: a fixed rubric, a pinned model, a structured verdict. Used for what code cannot decide."""
from __future__ import annotations

from importlib import resources

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models import Model

RUBRIC_VERSION = 1


class Verdict(BaseModel):
    score: int = Field(description="1 (bad) to 5 (excellent) against the rubric")
    reasoning: str = Field(description="two or three sentences")
    issues: list[str] = Field(default_factory=list, description="concrete problems found, short")

    @property
    def normalised(self) -> float:
        return (min(5, max(1, self.score)) - 1) / 4


def rubric_text(name: str) -> str:
    return (resources.files("bleep_agent") / "evals" / "rubrics" / f"{name}.md").read_text()


async def judge(model: Model, rubric: str, question: str, answer: str, context: str = "") -> Verdict:
    agent: Agent[None, Verdict] = Agent(model, output_type=Verdict, instructions=(
        "You are a strict, fair evaluator of an AI assistant for a modular synthesizer. Score the ANSWER to the QUESTION "
        "against the RUBRIC. Use only the CONTEXT as ground truth where given. Do not reward length.\n\n# RUBRIC\n" + rubric))
    prompt = f"# QUESTION\n{question}\n\n# CONTEXT\n{context or '(none)'}\n\n# ANSWER\n{answer}"
    res = await agent.run(prompt)
    return res.output
