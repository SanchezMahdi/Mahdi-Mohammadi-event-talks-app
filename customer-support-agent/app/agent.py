# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
import os
import re
from collections.abc import AsyncGenerator

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.apps import App
from google.adk.events.event import Event
from google.adk.models import Gemini
from google.adk.workflow import START, Workflow
from google.genai import Client, types
from pydantic import BaseModel, Field

load_dotenv()
logger = logging.getLogger(__name__)

# Model configuration
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")


class QueryClassification(BaseModel):
    """Structured output schema for classifying user queries."""

    is_shipping_related: bool = Field(
        description=(
            "True if the query relates to shipping, including shipping rates/quotes, "
            "package tracking, delivery status, shipping options, transit times, "
            "or returns/exchanges. False if unrelated to shipping."
        )
    )
    category: str = Field(
        description="The identified category: 'rates', 'tracking', 'delivery', 'returns', or 'unrelated'."
    )
    reasoning: str = Field(
        description="Brief explanation justifying the classification decision."
    )


def extract_query_text(node_input: types.Content | str | dict) -> str:
    """Extracts plain text query from various input formats."""
    if isinstance(node_input, str):
        return node_input
    if isinstance(node_input, dict):
        return node_input.get("text") or str(node_input)
    if hasattr(node_input, "parts") and node_input.parts:
        parts_text = [
            part.text for part in node_input.parts if getattr(part, "text", None)
        ]
        if parts_text:
            return " ".join(parts_text)
    return str(node_input)


async def classify_query(node_input: types.Content | str) -> Event:
    """Classifies user queries as either shipping-related or unrelated.

    Routes:
        - 'shipping': Query relates to rates, tracking, delivery, or returns.
        - 'unrelated': Query is outside the scope of shipping services.
    """
    query_text = extract_query_text(node_input)
    logger.info("Classifying query: %s", query_text)

    # Heuristic fallback keywords in case of transient model/network unavailability
    shipping_keywords = [
        "ship",
        "shipping",
        "rate",
        "rates",
        "quote",
        "cost",
        "price",
        "track",
        "tracking",
        "deliver",
        "delivery",
        "return",
        "returns",
        "refund",
        "package",
        "parcel",
        "freight",
        "courier",
        "transit",
        "postage",
        "carrier",
        "customs",
        "dimension",
        "weight",
        "pickup",
    ]

    is_shipping = False
    try:
        client = Client()
        prompt = (
            "You are a customer query classification specialist for SwiftShip Logistics.\n"
            f'Analyze the user query: "{query_text}"\n\n'
            "Determine if this query is related to shipping services. Shipping-related topics include:\n"
            "- Shipping rates, prices, quotes, weight/size fees, or express/ground options.\n"
            "- Package tracking, status updates, transit progress, or lost packages.\n"
            "- Delivery schedules, signature requirements, address changes, or delivery attempts.\n"
            "- Return policies, return shipping labels, drop-off locations, or return pickups.\n"
            "Any other topic (such as trivia, general chit-chat, coding, unrelated products) is 'unrelated'."
        )

        response = await client.aio.models.generate_content(
            model=MODEL,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": QueryClassification,
                "temperature": 0.0,
            },
        )
        if response.parsed:
            is_shipping = response.parsed.is_shipping_related
            logger.info(
                "Classification result: is_shipping=%s, category=%s",
                is_shipping,
                response.parsed.category,
            )
        else:
            lowered = query_text.lower()
            words = set(re.findall(r"\b\w+\b", lowered))
            is_shipping = any(kw in words for kw in shipping_keywords)
    except Exception as exc:
        logger.warning(
            "Classification model call encountered error: %s. Using heuristic fallback.",
            exc,
        )
        lowered = query_text.lower()
        words = set(re.findall(r"\b\w+\b", lowered))
        is_shipping = any(kw in words for kw in shipping_keywords)

    route = "shipping" if is_shipping else "unrelated"
    return Event(output=query_text, route=route)


# Shipping FAQ Agent for handling shipping-related queries
shipping_faq_agent = LlmAgent(
    name="shipping_faq_agent",
    model=Gemini(
        model=MODEL,
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction="""You are an expert customer support representative for SwiftShip Logistics, a premier shipping company.

Your responsibility is to assist customers with shipping-related inquiries:
1. Shipping Rates & Pricing:
   - Provide clear information on standard ground, express 2-day, and priority overnight shipping.
   - Explain that rates depend on package weight, dimensions, origin, destination, and service level.
2. Tracking & Status:
   - Help customers interpret package tracking statuses (e.g., 'In Transit', 'Out for Delivery', 'Delivered', 'Exception/Delay').
   - Guide customers on how to find tracking numbers and track parcels online.
3. Delivery Inquiries:
   - Assist with delivery timeframes, signature requirements, rescheduling, and safe drop-off options.
4. Returns & Exchanges:
   - Guide customers through generating return shipping labels, finding nearby drop-off locations, and scheduling courier pickups.

Guidelines:
- Maintain a warm, empathetic, and professional tone.
- Be concise yet thorough, offering clear next steps or options.
- If a tracking number is not provided when asking about a specific package, politely prompt the customer for it.""",
)


async def decline_unrelated(node_input: str) -> AsyncGenerator[Event, None]:
    """Politely declines to answer queries unrelated to shipping services."""
    decline_message = (
        "Thank you for contacting SwiftShip Customer Support! "
        "I am specialized exclusively in shipping-related inquiries—such as shipping rates, "
        "package tracking, delivery status, and returns. "
        "I cannot assist with queries outside of our shipping services. "
        "Please let me know if you have any questions regarding a shipment or our delivery options!"
    )
    yield Event(
        content=types.Content(
            role="model",
            parts=[types.Part.from_text(text=decline_message)],
        )
    )
    yield Event(output=decline_message)


# Define the Graph Workflow
root_agent = Workflow(
    name="customer_support_agent",
    description=(
        "Customer support graph workflow for a shipping company that classifies user queries "
        "into shipping-related vs. unrelated, routing to a Shipping FAQ Agent or polite declination."
    ),
    edges=[
        (START, classify_query),
        (
            classify_query,
            {
                "shipping": shipping_faq_agent,
                "unrelated": decline_unrelated,
            },
        ),
    ],
)

app = App(
    root_agent=root_agent,
    name="app",
)
