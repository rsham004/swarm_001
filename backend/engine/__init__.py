"""
Core Agent Learning Engine

A comprehensive framework for building and managing intelligent agents with learning capabilities,
neural network integration, and coordination protocols for the Swarm Coordination Mastery platform.

This engine provides:
- Base agent classes with learning capabilities
- Reinforcement learning algorithms
- Neural network framework integration (PyTorch/TensorFlow)
- Agent communication and coordination protocols
- Knowledge representation and storage
- Performance monitoring and metrics
- Configuration management and plugin architecture
"""

__version__ = "1.0.0"
__author__ = "Swarm Learning Team"
__license__ = "MIT"

from .core.agent import BaseAgent, LearningAgent
from .core.engine import LearningEngine
from .core.memory import MemoryManager, KnowledgeBase
from .core.communication import AgentCommunicator, CoordinationProtocol
from .core.neural import NeuralFramework, ModelManager
from .rl.algorithms import RLAlgorithm, PPOAlgorithm, DQNAlgorithm
from .rl.environment import AgentEnvironment, SwarmEnvironment
from .monitoring.metrics import MetricsCollector, PerformanceMonitor
from .config.manager import ConfigManager
from .plugins.base import PluginManager

__all__ = [
    # Core Components
    "BaseAgent",
    "LearningAgent", 
    "LearningEngine",
    "MemoryManager",
    "KnowledgeBase",
    "AgentCommunicator",
    "CoordinationProtocol",
    "NeuralFramework",
    "ModelManager",
    
    # Reinforcement Learning
    "RLAlgorithm",
    "PPOAlgorithm", 
    "DQNAlgorithm",
    "AgentEnvironment",
    "SwarmEnvironment",
    
    # Monitoring & Configuration
    "MetricsCollector",
    "PerformanceMonitor",
    "ConfigManager",
    "PluginManager",
]

# Version information
VERSION_INFO = {
    "major": 1,
    "minor": 0,
    "patch": 0,
    "pre_release": None
}

def get_version():
    """Get the current version string."""
    version = f"{VERSION_INFO['major']}.{VERSION_INFO['minor']}.{VERSION_INFO['patch']}"
    if VERSION_INFO['pre_release']:
        version += f"-{VERSION_INFO['pre_release']}"
    return version

# Engine configuration
DEFAULT_CONFIG = {
    "engine": {
        "max_agents": 100,
        "coordination_protocol": "hierarchical",
        "memory_backend": "redis",
        "neural_framework": "pytorch",
        "logging_level": "INFO"
    },
    "learning": {
        "algorithm": "ppo",
        "learning_rate": 0.001,
        "batch_size": 32,
        "memory_size": 10000,
        "exploration_rate": 0.1
    },
    "communication": {
        "protocol": "zmq",
        "port_range": [8000, 9000],
        "timeout": 30,
        "retry_attempts": 3
    },
    "monitoring": {
        "enable_metrics": True,
        "metrics_backend": "prometheus",
        "performance_tracking": True,
        "log_level": "INFO"
    }
}