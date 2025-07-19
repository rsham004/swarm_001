"""
Base Agent Classes with Learning Capabilities

This module provides the foundational agent classes that support:
- Autonomous learning and adaptation
- Memory management and knowledge retention
- Goal-oriented behavior and planning
- Communication and coordination with other agents
- Performance monitoring and metrics collection
"""

import asyncio
import uuid
import time
import logging
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional, Callable, Union
from dataclasses import dataclass, field
from enum import Enum
import numpy as np
import torch
import torch.nn as nn
from pydantic import BaseModel, Field

from .memory import MemoryManager, KnowledgeBase
from .communication import AgentCommunicator
from ..monitoring.metrics import MetricsCollector


class AgentState(Enum):
    """Agent lifecycle states."""
    INITIALIZING = "initializing"
    IDLE = "idle"
    LEARNING = "learning"
    EXECUTING = "executing"
    COMMUNICATING = "communicating"
    ERROR = "error"
    TERMINATED = "terminated"


class AgentType(Enum):
    """Agent specialization types."""
    RESEARCHER = "researcher"
    CODER = "coder"
    ANALYST = "analyst"
    OPTIMIZER = "optimizer"
    COORDINATOR = "coordinator"
    TESTER = "tester"
    GENERIC = "generic"


@dataclass
class AgentConfig:
    """Configuration for agent behavior and capabilities."""
    agent_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    agent_type: AgentType = AgentType.GENERIC
    learning_rate: float = 0.001
    memory_size: int = 10000
    max_concurrent_tasks: int = 5
    coordination_enabled: bool = True
    metrics_enabled: bool = True
    neural_framework: str = "pytorch"
    communication_protocol: str = "zmq"
    
    # Learning parameters
    exploration_rate: float = 0.1
    discount_factor: float = 0.99
    batch_size: int = 32
    update_frequency: int = 100
    
    # Memory parameters
    memory_backend: str = "redis"
    knowledge_retention: float = 0.95
    forgetting_threshold: float = 0.1
    
    # Communication parameters
    message_queue_size: int = 1000
    heartbeat_interval: int = 30
    timeout_duration: int = 60


class AgentAction(BaseModel):
    """Represents an action taken by an agent."""
    action_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    action_type: str
    parameters: Dict[str, Any] = Field(default_factory=dict)
    timestamp: float = Field(default_factory=time.time)
    expected_duration: Optional[float] = None
    priority: int = Field(default=5, ge=1, le=10)


class AgentObservation(BaseModel):
    """Represents an observation made by an agent."""
    observation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    observation_type: str
    data: Dict[str, Any]
    timestamp: float = Field(default_factory=time.time)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source: str


class AgentGoal(BaseModel):
    """Represents a goal that an agent is working towards."""
    goal_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str
    target_metrics: Dict[str, float] = Field(default_factory=dict)
    deadline: Optional[float] = None
    priority: int = Field(default=5, ge=1, le=10)
    status: str = Field(default="active")  # active, completed, failed, paused


class BaseAgent(ABC):
    """
    Abstract base class for all agents in the learning system.
    
    Provides core functionality for:
    - State management and lifecycle
    - Memory and knowledge management
    - Communication with other agents
    - Metrics collection and monitoring
    - Goal-oriented behavior
    """
    
    def __init__(self, config: AgentConfig):
        self.config = config
        self.agent_id = config.agent_id
        self.agent_type = config.agent_type
        self.state = AgentState.INITIALIZING
        
        # Core components
        self.memory_manager = MemoryManager(
            agent_id=self.agent_id,
            backend=config.memory_backend,
            max_size=config.memory_size
        )
        self.knowledge_base = KnowledgeBase(agent_id=self.agent_id)
        self.communicator = AgentCommunicator(
            agent_id=self.agent_id,
            protocol=config.communication_protocol
        )
        self.metrics_collector = MetricsCollector(
            agent_id=self.agent_id,
            enabled=config.metrics_enabled
        )
        
        # Internal state
        self.goals: List[AgentGoal] = []
        self.current_task: Optional[str] = None
        self.action_history: List[AgentAction] = []
        self.observation_history: List[AgentObservation] = []
        self.performance_metrics: Dict[str, float] = {}
        
        # Logging
        self.logger = logging.getLogger(f"agent.{self.agent_id}")
        
        # Async components
        self._running = False
        self._tasks: List[asyncio.Task] = []
        
    async def initialize(self) -> None:
        """Initialize the agent and its components."""
        try:
            self.logger.info(f"Initializing agent {self.agent_id} of type {self.agent_type}")
            
            # Initialize components
            await self.memory_manager.initialize()
            await self.knowledge_base.initialize()
            await self.communicator.initialize()
            await self.metrics_collector.initialize()
            
            # Load previous state if available
            await self._load_state()
            
            # Set up message handlers
            self.communicator.register_handler("coordination", self._handle_coordination)
            self.communicator.register_handler("learning", self._handle_learning_message)
            self.communicator.register_handler("goal", self._handle_goal_message)
            
            self.state = AgentState.IDLE
            self.logger.info(f"Agent {self.agent_id} initialized successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize agent {self.agent_id}: {e}")
            self.state = AgentState.ERROR
            raise
    
    async def start(self) -> None:
        """Start the agent's main execution loop."""
        if self._running:
            return
            
        self._running = True
        self.logger.info(f"Starting agent {self.agent_id}")
        
        # Start background tasks
        self._tasks.extend([
            asyncio.create_task(self._main_loop()),
            asyncio.create_task(self._heartbeat_loop()),
            asyncio.create_task(self._metrics_loop()),
            asyncio.create_task(self.communicator.listen())
        ])
        
        # Start agent-specific tasks
        await self._start_agent_tasks()
    
    async def stop(self) -> None:
        """Stop the agent and clean up resources."""
        self.logger.info(f"Stopping agent {self.agent_id}")
        self._running = False
        
        # Cancel all tasks
        for task in self._tasks:
            task.cancel()
        
        # Wait for tasks to complete
        await asyncio.gather(*self._tasks, return_exceptions=True)
        
        # Save state
        await self._save_state()
        
        # Cleanup components
        await self.communicator.cleanup()
        await self.memory_manager.cleanup()
        await self.metrics_collector.cleanup()
        
        self.state = AgentState.TERMINATED
        self.logger.info(f"Agent {self.agent_id} stopped")
    
    @abstractmethod
    async def process_observation(self, observation: AgentObservation) -> List[AgentAction]:
        """Process an observation and return appropriate actions."""
        pass
    
    @abstractmethod
    async def execute_action(self, action: AgentAction) -> Dict[str, Any]:
        """Execute an action and return results."""
        pass
    
    @abstractmethod
    async def update_knowledge(self, experience: Dict[str, Any]) -> None:
        """Update the agent's knowledge based on experience."""
        pass
    
    async def add_goal(self, goal: AgentGoal) -> None:
        """Add a new goal for the agent to work towards."""
        self.goals.append(goal)
        self.logger.info(f"Added goal: {goal.description}")
        await self.memory_manager.store_experience({
            "type": "goal_added",
            "goal": goal.dict(),
            "timestamp": time.time()
        })
    
    async def observe(self, observation: AgentObservation) -> None:
        """Process a new observation."""
        self.observation_history.append(observation)
        self.logger.debug(f"Received observation: {observation.observation_type}")
        
        # Store in memory
        await self.memory_manager.store_experience({
            "type": "observation",
            "observation": observation.dict(),
            "timestamp": time.time()
        })
        
        # Process observation and generate actions
        actions = await self.process_observation(observation)
        
        # Execute actions
        for action in actions:
            await self._execute_action_async(action)
    
    async def communicate(self, message: Dict[str, Any], target_agent: Optional[str] = None) -> None:
        """Send a message to other agents."""
        await self.communicator.send_message(message, target_agent)
        self.logger.debug(f"Sent message: {message.get('type', 'unknown')}")
    
    async def get_metrics(self) -> Dict[str, Any]:
        """Get current performance metrics."""
        base_metrics = {
            "agent_id": self.agent_id,
            "agent_type": self.agent_type.value,
            "state": self.state.value,
            "goals_count": len(self.goals),
            "active_goals": len([g for g in self.goals if g.status == "active"]),
            "completed_goals": len([g for g in self.goals if g.status == "completed"]),
            "actions_taken": len(self.action_history),
            "observations_processed": len(self.observation_history),
            "memory_utilization": await self.memory_manager.get_utilization(),
            "uptime": time.time() - self.metrics_collector.start_time
        }
        
        # Add agent-specific metrics
        agent_metrics = await self._get_agent_metrics()
        base_metrics.update(agent_metrics)
        
        return base_metrics
    
    async def _main_loop(self) -> None:
        """Main agent execution loop."""
        while self._running:
            try:
                if self.state == AgentState.IDLE:
                    # Check for pending goals
                    active_goals = [g for g in self.goals if g.status == "active"]
                    if active_goals:
                        self.state = AgentState.EXECUTING
                        await self._work_on_goals(active_goals)
                        self.state = AgentState.IDLE
                
                await asyncio.sleep(1)  # Prevent busy waiting
                
            except Exception as e:
                self.logger.error(f"Error in main loop: {e}")
                self.state = AgentState.ERROR
                await asyncio.sleep(5)  # Error backoff
    
    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeat messages."""
        while self._running:
            try:
                heartbeat = {
                    "type": "heartbeat",
                    "agent_id": self.agent_id,
                    "timestamp": time.time(),
                    "state": self.state.value,
                    "metrics": await self.get_metrics()
                }
                await self.communicate(heartbeat)
                await asyncio.sleep(self.config.heartbeat_interval)
                
            except Exception as e:
                self.logger.error(f"Error in heartbeat loop: {e}")
                await asyncio.sleep(self.config.heartbeat_interval)
    
    async def _metrics_loop(self) -> None:
        """Collect and report metrics periodically."""
        while self._running:
            try:
                metrics = await self.get_metrics()
                await self.metrics_collector.record_metrics(metrics)
                await asyncio.sleep(60)  # Collect metrics every minute
                
            except Exception as e:
                self.logger.error(f"Error in metrics loop: {e}")
                await asyncio.sleep(60)
    
    async def _execute_action_async(self, action: AgentAction) -> None:
        """Execute an action asynchronously."""
        try:
            self.action_history.append(action)
            self.logger.debug(f"Executing action: {action.action_type}")
            
            start_time = time.time()
            result = await self.execute_action(action)
            execution_time = time.time() - start_time
            
            # Store experience
            experience = {
                "type": "action_execution",
                "action": action.dict(),
                "result": result,
                "execution_time": execution_time,
                "timestamp": time.time()
            }
            
            await self.memory_manager.store_experience(experience)
            await self.update_knowledge(experience)
            
            # Update metrics
            await self.metrics_collector.record_action(action.action_type, execution_time)
            
        except Exception as e:
            self.logger.error(f"Error executing action {action.action_type}: {e}")
            await self.metrics_collector.record_error(action.action_type, str(e))
    
    async def _handle_coordination(self, message: Dict[str, Any]) -> None:
        """Handle coordination messages from other agents."""
        coord_type = message.get("coordination_type")
        
        if coord_type == "task_assignment":
            await self._handle_task_assignment(message)
        elif coord_type == "resource_sharing":
            await self._handle_resource_sharing(message)
        elif coord_type == "knowledge_sharing":
            await self._handle_knowledge_sharing(message)
        else:
            self.logger.warning(f"Unknown coordination type: {coord_type}")
    
    async def _handle_learning_message(self, message: Dict[str, Any]) -> None:
        """Handle learning-related messages."""
        learning_type = message.get("learning_type")
        
        if learning_type == "model_update":
            await self._handle_model_update(message)
        elif learning_type == "experience_sharing":
            await self._handle_experience_sharing(message)
        else:
            self.logger.warning(f"Unknown learning type: {learning_type}")
    
    async def _handle_goal_message(self, message: Dict[str, Any]) -> None:
        """Handle goal-related messages."""
        goal_action = message.get("action")
        
        if goal_action == "add":
            goal_data = message.get("goal_data")
            goal = AgentGoal(**goal_data)
            await self.add_goal(goal)
        elif goal_action == "update":
            await self._update_goal(message)
        elif goal_action == "remove":
            await self._remove_goal(message)
    
    async def _load_state(self) -> None:
        """Load agent state from persistent storage."""
        try:
            state_data = await self.memory_manager.get_agent_state()
            if state_data:
                # Restore goals
                if "goals" in state_data:
                    self.goals = [AgentGoal(**goal_data) for goal_data in state_data["goals"]]
                
                # Restore performance metrics
                if "performance_metrics" in state_data:
                    self.performance_metrics = state_data["performance_metrics"]
                
                self.logger.info(f"Loaded state for agent {self.agent_id}")
        except Exception as e:
            self.logger.warning(f"Could not load agent state: {e}")
    
    async def _save_state(self) -> None:
        """Save agent state to persistent storage."""
        try:
            state_data = {
                "agent_id": self.agent_id,
                "agent_type": self.agent_type.value,
                "goals": [goal.dict() for goal in self.goals],
                "performance_metrics": self.performance_metrics,
                "timestamp": time.time()
            }
            await self.memory_manager.save_agent_state(state_data)
            self.logger.info(f"Saved state for agent {self.agent_id}")
        except Exception as e:
            self.logger.error(f"Could not save agent state: {e}")
    
    @abstractmethod
    async def _start_agent_tasks(self) -> None:
        """Start agent-specific background tasks."""
        pass
    
    @abstractmethod
    async def _work_on_goals(self, goals: List[AgentGoal]) -> None:
        """Work on achieving the given goals."""
        pass
    
    @abstractmethod
    async def _get_agent_metrics(self) -> Dict[str, Any]:
        """Get agent-specific metrics."""
        pass
    
    @abstractmethod
    async def _handle_task_assignment(self, message: Dict[str, Any]) -> None:
        """Handle task assignment from coordination."""
        pass
    
    @abstractmethod
    async def _handle_resource_sharing(self, message: Dict[str, Any]) -> None:
        """Handle resource sharing requests."""
        pass
    
    @abstractmethod
    async def _handle_knowledge_sharing(self, message: Dict[str, Any]) -> None:
        """Handle knowledge sharing from other agents."""
        pass
    
    @abstractmethod
    async def _handle_model_update(self, message: Dict[str, Any]) -> None:
        """Handle neural model updates."""
        pass
    
    @abstractmethod
    async def _handle_experience_sharing(self, message: Dict[str, Any]) -> None:
        """Handle shared experiences from other agents."""
        pass
    
    async def _update_goal(self, message: Dict[str, Any]) -> None:
        """Update an existing goal."""
        goal_id = message.get("goal_id")
        updates = message.get("updates", {})
        
        for goal in self.goals:
            if goal.goal_id == goal_id:
                for key, value in updates.items():
                    if hasattr(goal, key):
                        setattr(goal, key, value)
                break
    
    async def _remove_goal(self, message: Dict[str, Any]) -> None:
        """Remove a goal."""
        goal_id = message.get("goal_id")
        self.goals = [goal for goal in self.goals if goal.goal_id != goal_id]


class LearningAgent(BaseAgent):
    """
    Enhanced agent with advanced learning capabilities.
    
    Features:
    - Neural network integration
    - Reinforcement learning algorithms
    - Adaptive behavior based on experience
    - Knowledge transfer between agents
    - Performance optimization
    """
    
    def __init__(self, config: AgentConfig):
        super().__init__(config)
        
        # Learning components
        self.neural_model: Optional[nn.Module] = None
        self.optimizer: Optional[torch.optim.Optimizer] = None
        self.learning_algorithm: Optional[str] = None
        self.experience_buffer: List[Dict[str, Any]] = []
        
        # Learning parameters
        self.learning_rate = config.learning_rate
        self.exploration_rate = config.exploration_rate
        self.discount_factor = config.discount_factor
        self.batch_size = config.batch_size
        
        # Performance tracking
        self.learning_metrics = {
            "episodes": 0,
            "total_reward": 0.0,
            "average_reward": 0.0,
            "loss": 0.0,
            "exploration_rate": self.exploration_rate
        }
    
    async def initialize(self) -> None:
        """Initialize the learning agent."""
        await super().initialize()
        
        # Initialize neural model
        await self._initialize_neural_model()
        
        # Load pre-trained weights if available
        await self._load_model_weights()
        
        self.logger.info(f"Learning agent {self.agent_id} initialized with neural model")
    
    async def learn_from_experience(self, experience: Dict[str, Any]) -> None:
        """Learn from a single experience."""
        self.experience_buffer.append(experience)
        
        # Train if we have enough experiences
        if len(self.experience_buffer) >= self.batch_size:
            await self._train_model()
    
    async def share_knowledge(self, target_agent: str, knowledge_type: str) -> None:
        """Share knowledge with another agent."""
        if knowledge_type == "model_weights" and self.neural_model:
            weights = self.neural_model.state_dict()
            message = {
                "type": "learning",
                "learning_type": "model_update",
                "weights": weights,
                "source_agent": self.agent_id,
                "knowledge_type": knowledge_type
            }
            await self.communicate(message, target_agent)
        
        elif knowledge_type == "experiences":
            # Share recent experiences
            recent_experiences = self.experience_buffer[-100:]  # Last 100 experiences
            message = {
                "type": "learning",
                "learning_type": "experience_sharing",
                "experiences": recent_experiences,
                "source_agent": self.agent_id
            }
            await self.communicate(message, target_agent)
    
    async def process_observation(self, observation: AgentObservation) -> List[AgentAction]:
        """Process observation using neural model."""
        if not self.neural_model:
            return []
        
        try:
            # Convert observation to tensor
            obs_tensor = self._observation_to_tensor(observation)
            
            # Get action probabilities from model
            with torch.no_grad():
                action_probs = self.neural_model(obs_tensor)
            
            # Select action (epsilon-greedy)
            if np.random.random() < self.exploration_rate:
                # Explore: random action
                action_idx = np.random.randint(len(action_probs))
            else:
                # Exploit: best action
                action_idx = torch.argmax(action_probs).item()
            
            # Convert to AgentAction
            action = self._index_to_action(action_idx, observation)
            return [action]
            
        except Exception as e:
            self.logger.error(f"Error processing observation: {e}")
            return []
    
    async def execute_action(self, action: AgentAction) -> Dict[str, Any]:
        """Execute action and return results."""
        # This is agent-specific - should be implemented by subclasses
        result = {
            "action_id": action.action_id,
            "status": "completed",
            "timestamp": time.time(),
            "execution_time": 0.1  # Placeholder
        }
        return result
    
    async def update_knowledge(self, experience: Dict[str, Any]) -> None:
        """Update knowledge from experience."""
        await self.learn_from_experience(experience)
        
        # Update knowledge base
        await self.knowledge_base.add_experience(experience)
        
        # Update exploration rate (decay)
        self.exploration_rate = max(0.01, self.exploration_rate * 0.995)
        self.learning_metrics["exploration_rate"] = self.exploration_rate
    
    async def _initialize_neural_model(self) -> None:
        """Initialize the neural model architecture."""
        # Simple feedforward network as example
        input_size = 128  # Observation feature size
        hidden_size = 256
        output_size = 10  # Number of possible actions
        
        self.neural_model = nn.Sequential(
            nn.Linear(input_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, output_size),
            nn.Softmax(dim=-1)
        )
        
        # Initialize optimizer
        self.optimizer = torch.optim.Adam(
            self.neural_model.parameters(),
            lr=self.learning_rate
        )
    
    async def _train_model(self) -> None:
        """Train the neural model on experience buffer."""
        if not self.neural_model or not self.optimizer:
            return
        
        try:
            # Sample batch from experience buffer
            batch = np.random.choice(
                self.experience_buffer,
                size=min(self.batch_size, len(self.experience_buffer)),
                replace=False
            ).tolist()
            
            # Prepare training data
            states = []
            actions = []
            rewards = []
            next_states = []
            
            for exp in batch:
                if "state" in exp and "action" in exp and "reward" in exp:
                    states.append(exp["state"])
                    actions.append(exp["action"])
                    rewards.append(exp["reward"])
                    next_states.append(exp.get("next_state", exp["state"]))
            
            if not states:
                return
            
            # Convert to tensors
            state_tensor = torch.FloatTensor(states)
            action_tensor = torch.LongTensor(actions)
            reward_tensor = torch.FloatTensor(rewards)
            next_state_tensor = torch.FloatTensor(next_states)
            
            # Forward pass
            current_q_values = self.neural_model(state_tensor)
            next_q_values = self.neural_model(next_state_tensor)
            
            # Compute target Q-values
            target_q_values = current_q_values.clone()
            for i in range(len(batch)):
                target_q_values[i][action_tensor[i]] = (
                    reward_tensor[i] + 
                    self.discount_factor * torch.max(next_q_values[i])
                )
            
            # Compute loss
            loss = nn.MSELoss()(current_q_values, target_q_values.detach())
            
            # Backward pass
            self.optimizer.zero_grad()
            loss.backward()
            self.optimizer.step()
            
            # Update metrics
            self.learning_metrics["loss"] = loss.item()
            self.learning_metrics["episodes"] += 1
            
            # Clear old experiences
            if len(self.experience_buffer) > self.config.memory_size:
                self.experience_buffer = self.experience_buffer[-self.config.memory_size:]
            
        except Exception as e:
            self.logger.error(f"Error training model: {e}")
    
    def _observation_to_tensor(self, observation: AgentObservation) -> torch.Tensor:
        """Convert observation to tensor for neural model."""
        # Simple conversion - should be customized per agent type
        features = []
        
        # Add basic features
        features.extend([
            observation.confidence,
            len(str(observation.data)),
            hash(observation.observation_type) % 1000 / 1000.0,
            time.time() % 3600 / 3600.0  # Time of day
        ])
        
        # Pad to fixed size
        while len(features) < 128:
            features.append(0.0)
        
        return torch.FloatTensor(features[:128])
    
    def _index_to_action(self, action_idx: int, observation: AgentObservation) -> AgentAction:
        """Convert action index to AgentAction."""
        action_types = [
            "analyze", "communicate", "learn", "plan", "execute",
            "coordinate", "optimize", "monitor", "adapt", "report"
        ]
        
        action_type = action_types[action_idx % len(action_types)]
        
        return AgentAction(
            action_type=action_type,
            parameters={
                "observation_id": observation.observation_id,
                "confidence": observation.confidence,
                "context": "neural_decision"
            }
        )
    
    async def _load_model_weights(self) -> None:
        """Load pre-trained model weights if available."""
        try:
            weights_data = await self.memory_manager.get_model_weights()
            if weights_data and self.neural_model:
                self.neural_model.load_state_dict(weights_data)
                self.logger.info("Loaded pre-trained model weights")
        except Exception as e:
            self.logger.warning(f"Could not load model weights: {e}")
    
    async def _save_model_weights(self) -> None:
        """Save current model weights."""
        try:
            if self.neural_model:
                weights = self.neural_model.state_dict()
                await self.memory_manager.save_model_weights(weights)
        except Exception as e:
            self.logger.error(f"Could not save model weights: {e}")
    
    # Implementation of abstract methods
    async def _start_agent_tasks(self) -> None:
        """Start learning-specific background tasks."""
        # Add periodic model saving
        self._tasks.append(
            asyncio.create_task(self._periodic_model_save())
        )
        
        # Add exploration rate decay
        self._tasks.append(
            asyncio.create_task(self._exploration_decay_loop())
        )
    
    async def _work_on_goals(self, goals: List[AgentGoal]) -> None:
        """Work on achieving goals using learned behavior."""
        for goal in goals:
            if goal.status != "active":
                continue
            
            # Create observation from goal
            goal_observation = AgentObservation(
                observation_type="goal",
                data=goal.dict(),
                source="goal_system"
            )
            
            # Process and execute actions
            actions = await self.process_observation(goal_observation)
            for action in actions:
                await self._execute_action_async(action)
                
                # Check if goal is completed
                if await self._is_goal_completed(goal):
                    goal.status = "completed"
                    self.logger.info(f"Completed goal: {goal.description}")
                    break
    
    async def _get_agent_metrics(self) -> Dict[str, Any]:
        """Get learning-specific metrics."""
        return {
            **self.learning_metrics,
            "experience_buffer_size": len(self.experience_buffer),
            "model_parameters": sum(p.numel() for p in self.neural_model.parameters()) if self.neural_model else 0
        }
    
    async def _handle_task_assignment(self, message: Dict[str, Any]) -> None:
        """Handle task assignment with learning context."""
        task_data = message.get("task_data", {})
        goal = AgentGoal(
            description=task_data.get("description", "Assigned task"),
            target_metrics=task_data.get("target_metrics", {}),
            priority=task_data.get("priority", 5)
        )
        await self.add_goal(goal)
    
    async def _handle_resource_sharing(self, message: Dict[str, Any]) -> None:
        """Handle resource sharing with learning optimization."""
        resource_type = message.get("resource_type")
        if resource_type == "computation":
            # Share computational resources
            pass
        elif resource_type == "data":
            # Share training data
            pass
    
    async def _handle_knowledge_sharing(self, message: Dict[str, Any]) -> None:
        """Handle knowledge sharing from other agents."""
        knowledge_type = message.get("knowledge_type")
        if knowledge_type == "experiences":
            experiences = message.get("experiences", [])
            self.experience_buffer.extend(experiences)
        elif knowledge_type == "model_insights":
            insights = message.get("insights", {})
            await self.knowledge_base.add_insights(insights)
    
    async def _handle_model_update(self, message: Dict[str, Any]) -> None:
        """Handle neural model updates from other agents."""
        weights = message.get("weights")
        if weights and self.neural_model:
            # Federated learning: average weights
            current_weights = self.neural_model.state_dict()
            for key in current_weights:
                if key in weights:
                    current_weights[key] = (current_weights[key] + weights[key]) / 2
            self.neural_model.load_state_dict(current_weights)
    
    async def _handle_experience_sharing(self, message: Dict[str, Any]) -> None:
        """Handle shared experiences from other agents."""
        experiences = message.get("experiences", [])
        # Filter and validate experiences before adding
        valid_experiences = [exp for exp in experiences if self._validate_experience(exp)]
        self.experience_buffer.extend(valid_experiences)
    
    def _validate_experience(self, experience: Dict[str, Any]) -> bool:
        """Validate that an experience is suitable for learning."""
        required_fields = ["action", "state", "reward"]
        return all(field in experience for field in required_fields)
    
    async def _periodic_model_save(self) -> None:
        """Periodically save model weights."""
        while self._running:
            await asyncio.sleep(300)  # Save every 5 minutes
            await self._save_model_weights()
    
    async def _exploration_decay_loop(self) -> None:
        """Gradually decay exploration rate."""
        while self._running:
            await asyncio.sleep(60)  # Check every minute
            if self.exploration_rate > 0.01:
                self.exploration_rate *= 0.999
                self.learning_metrics["exploration_rate"] = self.exploration_rate
    
    async def _is_goal_completed(self, goal: AgentGoal) -> bool:
        """Check if a goal has been completed."""
        # Simple heuristic - should be customized per goal type
        return time.time() - goal.timestamp > 60  # Consider completed after 1 minute