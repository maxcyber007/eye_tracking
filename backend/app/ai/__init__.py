"""AI layer: landmark extraction, feature engineering, training and inference.

Importing this package registers every bundled model implementation, so
:func:`app.ai.base.create_model` can resolve them by name.
"""

from __future__ import annotations

from app.ai.base import (
    BaseRiskModel,
    ModelBundle,
    TrainingMetrics,
    available_models,
    create_model,
    register_model,
)
from app.ai.estimators import GradientBoostingRiskModel, RandomForestRiskModel
from app.ai.extract_feature import (
    EyeFeatureExtractor,
    ExtractionResult,
    VideoMetadata,
    extract_features_from_video,
)
from app.ai.feature_engineering import (
    DatasetRepository,
    FeatureEngineer,
    FeatureVector,
    build_feature_vector,
)
from app.ai.pipeline import AnalysisResult, EyeTrackingPipeline
from app.ai.predict_model import PredictionResult, RiskPredictor, get_predictor
from app.ai.train_model import ModelTrainer, TrainingResult, train_model

__all__ = [
    "AnalysisResult",
    "BaseRiskModel",
    "DatasetRepository",
    "EyeFeatureExtractor",
    "EyeTrackingPipeline",
    "ExtractionResult",
    "FeatureEngineer",
    "FeatureVector",
    "GradientBoostingRiskModel",
    "ModelBundle",
    "ModelTrainer",
    "PredictionResult",
    "RandomForestRiskModel",
    "RiskPredictor",
    "TrainingMetrics",
    "TrainingResult",
    "VideoMetadata",
    "available_models",
    "build_feature_vector",
    "create_model",
    "extract_features_from_video",
    "get_predictor",
    "register_model",
    "train_model",
]
