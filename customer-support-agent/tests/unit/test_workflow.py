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

import pytest
from google.adk.apps import App
from google.adk.runners import InMemoryRunner
from google.adk.workflow import Workflow
from google.genai import types

from app.agent import app as customer_support_app
from app.agent import classify_query, decline_unrelated, root_agent, shipping_faq_agent


def test_workflow_graph_structure():
    """Validates the graph workflow topology and edge configuration."""
    assert isinstance(root_agent, Workflow)
    assert root_agent.name == "customer_support_agent"
    assert len(root_agent.edges) == 2

    # Start edge: ('__START__', classify_query)
    start_edge = root_agent.edges[0]
    assert start_edge[0].name == "__START__"
    assert start_edge[1] == classify_query

    # Routing edge: (classify_query, {'shipping': shipping_faq_agent, 'unrelated': decline_unrelated})
    route_edge = root_agent.edges[1]
    assert route_edge[0] == classify_query
    assert isinstance(route_edge[1], dict)
    assert route_edge[1]["shipping"] == shipping_faq_agent
    assert route_edge[1]["unrelated"] == decline_unrelated


@pytest.mark.asyncio
async def test_classification_and_routing_shipping():
    """Validates that shipping queries are classified and routed properly."""
    event = await classify_query("How can I track my package with ID SW-987654?")
    assert event.actions.route == "shipping"


@pytest.mark.asyncio
async def test_classification_and_routing_unrelated():
    """Validates that unrelated queries are classified and routed to declination."""
    event = await classify_query("What is the best way to bake sourdough bread?")
    assert event.actions.route == "unrelated"


@pytest.mark.asyncio
async def test_decline_unrelated_output():
    """Validates the polite declination response content."""
    events = []
    async for ev in decline_unrelated("Unrelated prompt"):
        events.append(ev)

    assert len(events) == 2
    # Content event
    assert events[0].content is not None
    assert "SwiftShip" in events[0].content.parts[0].text
    assert "shipping-related" in events[0].content.parts[0].text
    # Output event
    assert "SwiftShip" in events[1].output


@pytest.mark.asyncio
async def test_workflow_end_to_end_unrelated():
    """Validates complete workflow execution for an unrelated query via InMemoryRunner."""
    runner = InMemoryRunner(app=customer_support_app)
    session = await runner.session_service.create_session(
        app_name=customer_support_app.name, user_id="test_user"
    )

    collected_text = []
    async for event in runner.run_async(
        user_id="test_user",
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text="What is the weather like on Jupiter?")],
        ),
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.text:
                    collected_text.append(part.text)

    full_response = " ".join(collected_text)
    assert "shipping-related" in full_response.lower()
    assert "swiftship" in full_response.lower()
