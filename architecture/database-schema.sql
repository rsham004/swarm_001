-- Database Schema for Swarm Coordination Mastery Learning Platform
-- PostgreSQL Schema Design

-- ============================================================================
-- User Management Schema
-- ============================================================================

-- Users table - Core user information
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    avatar_url VARCHAR(500),
    bio TEXT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    language VARCHAR(10) DEFAULT 'en',
    email_verified BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE,
    email_verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    
    -- Profile settings
    notification_preferences JSONB DEFAULT '{"email": true, "push": true, "sms": false}',
    privacy_settings JSONB DEFAULT '{"profile_public": true, "progress_public": false}',
    learning_preferences JSONB DEFAULT '{"learning_style": "mixed", "pace": "normal"}'
);

-- Roles table - Role-based access control
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User roles junction table
CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    granted_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, role_id)
);

-- User sessions for authentication
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    refresh_token VARCHAR(255) UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    device_info JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- ============================================================================
-- Content Management Schema
-- ============================================================================

-- Learning levels (Beginner, Intermediate, Advanced)
CREATE TABLE learning_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL,
    estimated_hours INTEGER NOT NULL,
    prerequisites TEXT[],
    learning_objectives TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Courses within each level
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level_id UUID REFERENCES learning_levels(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    order_index INTEGER NOT NULL,
    estimated_hours DECIMAL(4,2) NOT NULL,
    difficulty_level VARCHAR(20) DEFAULT 'beginner',
    thumbnail_url VARCHAR(500),
    is_published BOOLEAN DEFAULT false,
    prerequisites TEXT[],
    learning_outcomes TEXT[],
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    
    -- SEO and metadata
    slug VARCHAR(255) UNIQUE NOT NULL,
    meta_description TEXT,
    meta_keywords TEXT[]
);

-- Modules within each course
CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    module_type VARCHAR(50) NOT NULL, -- 'video', 'text', 'interactive', 'assessment', 'hands-on'
    content_url VARCHAR(500),
    content_data JSONB, -- Structured content data
    is_published BOOLEAN DEFAULT false,
    is_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Module-specific settings
    settings JSONB DEFAULT '{}',
    resources JSONB DEFAULT '[]' -- Additional resources, links, files
);

-- Assessments and quizzes
CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assessment_type VARCHAR(50) NOT NULL, -- 'quiz', 'assignment', 'project', 'peer_review'
    passing_score DECIMAL(5,2) DEFAULT 70.00,
    max_attempts INTEGER DEFAULT 3,
    time_limit_minutes INTEGER,
    is_required BOOLEAN DEFAULT true,
    weight DECIMAL(5,2) DEFAULT 1.00, -- Weight in overall course grade
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Assessment configuration
    settings JSONB DEFAULT '{}',
    rubric JSONB -- Grading rubric for assignments
);

-- Assessment questions
CREATE TABLE assessment_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID REFERENCES assessments(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type VARCHAR(50) NOT NULL, -- 'multiple_choice', 'true_false', 'short_answer', 'essay', 'code'
    order_index INTEGER NOT NULL,
    points DECIMAL(5,2) DEFAULT 1.00,
    correct_answer JSONB, -- Correct answer(s)
    options JSONB, -- Multiple choice options
    explanation TEXT,
    hints TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Progress Tracking Schema
-- ============================================================================

-- User enrollments in courses
CREATE TABLE user_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    progress_percentage DECIMAL(5,2) DEFAULT 0.00,
    current_module_id UUID REFERENCES modules(id),
    is_active BOOLEAN DEFAULT true,
    
    -- Enrollment metadata
    enrollment_source VARCHAR(50), -- 'self', 'admin', 'bulk_import'
    access_expires_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(user_id, course_id)
);

-- Detailed progress tracking for modules
CREATE TABLE user_module_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    enrollment_id UUID REFERENCES user_enrollments(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    progress_percentage DECIMAL(5,2) DEFAULT 0.00,
    time_spent_minutes INTEGER DEFAULT 0,
    last_accessed TIMESTAMP WITH TIME ZONE,
    is_completed BOOLEAN DEFAULT false,
    
    -- Module interaction data
    interaction_data JSONB DEFAULT '{}', -- Clicks, scrolls, pauses, etc.
    
    UNIQUE(user_id, module_id)
);

-- Assessment attempts and results
CREATE TABLE assessment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    assessment_id UUID REFERENCES assessments(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    score DECIMAL(5,2),
    max_score DECIMAL(5,2),
    percentage DECIMAL(5,2),
    is_passed BOOLEAN DEFAULT false,
    time_taken_minutes INTEGER,
    
    -- Attempt metadata
    answers JSONB, -- User answers
    auto_graded BOOLEAN DEFAULT false,
    graded_by UUID REFERENCES users(id),
    graded_at TIMESTAMP WITH TIME ZONE,
    feedback TEXT,
    
    UNIQUE(user_id, assessment_id, attempt_number)
);

-- Certificates and achievements
CREATE TABLE certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    level_id UUID REFERENCES learning_levels(id) ON DELETE CASCADE,
    certificate_type VARCHAR(50) NOT NULL, -- 'completion', 'achievement', 'mastery'
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    certificate_number VARCHAR(100) UNIQUE NOT NULL,
    verification_code VARCHAR(50) UNIQUE NOT NULL,
    
    -- Certificate metadata
    issued_by UUID REFERENCES users(id),
    template_id UUID,
    metadata JSONB DEFAULT '{}',
    
    -- Public verification
    is_public BOOLEAN DEFAULT true,
    blockchain_hash VARCHAR(255) -- For blockchain verification
);

-- ============================================================================
-- Swarm Coordination Schema
-- ============================================================================

-- Swarm environments and labs
CREATE TABLE swarm_environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    environment_type VARCHAR(50) NOT NULL, -- 'sandbox', 'lab', 'production'
    configuration JSONB NOT NULL,
    resource_limits JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    
    -- Environment settings
    is_active BOOLEAN DEFAULT true,
    auto_cleanup_hours INTEGER DEFAULT 24,
    max_users INTEGER DEFAULT 100
);

-- User swarm sessions
CREATE TABLE user_swarm_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    environment_id UUID REFERENCES swarm_environments(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'completed', 'failed', 'timeout'
    
    -- Session data
    swarm_config JSONB,
    resource_usage JSONB,
    logs JSONB,
    performance_metrics JSONB,
    
    -- Lab exercise tracking
    exercise_id UUID,
    exercise_results JSONB
);

-- Neural patterns and learning data
CREATE TABLE neural_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    pattern_type VARCHAR(50) NOT NULL, -- 'coordination', 'optimization', 'prediction'
    pattern_data JSONB NOT NULL,
    training_iterations INTEGER DEFAULT 0,
    accuracy_score DECIMAL(5,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Pattern metadata
    model_version VARCHAR(50),
    training_data_hash VARCHAR(255),
    performance_metrics JSONB
);

-- ============================================================================
-- Analytics and Reporting Schema
-- ============================================================================

-- Learning analytics events
CREATE TABLE learning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL, -- 'module_start', 'module_complete', 'assessment_attempt', etc.
    event_data JSONB NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Event context
    course_id UUID REFERENCES courses(id),
    module_id UUID REFERENCES modules(id),
    assessment_id UUID REFERENCES assessments(id),
    session_id UUID REFERENCES user_sessions(id),
    
    -- Event metadata
    device_type VARCHAR(50),
    browser VARCHAR(100),
    ip_address INET,
    user_agent TEXT
);

-- Performance metrics aggregation
CREATE TABLE performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_type VARCHAR(100) NOT NULL, -- 'course_completion', 'user_engagement', 'system_performance'
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(10,4) NOT NULL,
    dimensions JSONB, -- Additional dimensions for filtering
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Aggregation metadata
    aggregation_period VARCHAR(20), -- 'hour', 'day', 'week', 'month'
    aggregation_function VARCHAR(20), -- 'sum', 'avg', 'count', 'max', 'min'
    
    UNIQUE(metric_type, metric_name, dimensions, aggregation_period, timestamp)
);

-- ============================================================================
-- System Configuration Schema
-- ============================================================================

-- System settings and configuration
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id),
    
    UNIQUE(category, key)
);

-- Audit logs for compliance
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Audit metadata
    correlation_id UUID,
    session_id UUID REFERENCES user_sessions(id)
);

-- ============================================================================
-- Indexes for Performance Optimization
-- ============================================================================

-- User-related indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_last_login ON users(last_login);

-- Content-related indexes
CREATE INDEX idx_courses_level_id ON courses(level_id);
CREATE INDEX idx_courses_slug ON courses(slug);
CREATE INDEX idx_courses_is_published ON courses(is_published);
CREATE INDEX idx_modules_course_id ON modules(course_id);
CREATE INDEX idx_modules_order_index ON modules(order_index);

-- Progress tracking indexes
CREATE INDEX idx_user_enrollments_user_id ON user_enrollments(user_id);
CREATE INDEX idx_user_enrollments_course_id ON user_enrollments(course_id);
CREATE INDEX idx_user_module_progress_user_id ON user_module_progress(user_id);
CREATE INDEX idx_user_module_progress_module_id ON user_module_progress(module_id);
CREATE INDEX idx_assessment_attempts_user_id ON assessment_attempts(user_id);
CREATE INDEX idx_assessment_attempts_assessment_id ON assessment_attempts(assessment_id);

-- Analytics indexes
CREATE INDEX idx_learning_events_user_id ON learning_events(user_id);
CREATE INDEX idx_learning_events_timestamp ON learning_events(timestamp);
CREATE INDEX idx_learning_events_event_type ON learning_events(event_type);
CREATE INDEX idx_performance_metrics_timestamp ON performance_metrics(timestamp);
CREATE INDEX idx_performance_metrics_type_name ON performance_metrics(metric_type, metric_name);

-- Audit and session indexes
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);

-- ============================================================================
-- Initial Data Setup
-- ============================================================================

-- Insert default roles
INSERT INTO roles (name, description, permissions) VALUES
('admin', 'System Administrator', '{"all": true}'),
('instructor', 'Course Instructor', '{"courses": {"read": true, "write": true}, "users": {"read": true}}'),
('student', 'Student', '{"courses": {"read": true}, "progress": {"read": true, "write": true}}'),
('guest', 'Guest User', '{"courses": {"read": true}}');

-- Insert learning levels
INSERT INTO learning_levels (name, description, order_index, estimated_hours, prerequisites, learning_objectives) VALUES
('Beginner', 'Introduction to Swarm Coordination fundamentals', 1, 4, '{}', 
 '{"Understand basic swarm concepts", "Set up ruv-swarm environment", "Create simple swarm configurations"}'),
('Intermediate', 'Advanced Swarm Coordination techniques', 2, 8, '{"Beginner Level Completion"}',
 '{"Implement complex swarm topologies", "Master SPARC methodology", "Build enterprise-grade solutions"}'),
('Advanced', 'Expert-level Swarm Coordination mastery', 3, 12, '{"Intermediate Level Completion"}',
 '{"Design distributed systems", "Optimize performance at scale", "Lead swarm adoption initiatives"}');

-- Insert system settings
INSERT INTO system_settings (category, key, value, description, is_public) VALUES
('platform', 'name', '"Swarm Coordination Mastery"', 'Platform name', true),
('platform', 'version', '"1.0.0"', 'Platform version', true),
('auth', 'jwt_expiry', '3600', 'JWT token expiry in seconds', false),
('auth', 'max_login_attempts', '5', 'Maximum login attempts before lockout', false),
('content', 'max_file_size', '104857600', 'Maximum file upload size in bytes (100MB)', false),
('learning', 'completion_threshold', '80', 'Minimum percentage to consider module complete', true);

-- ============================================================================
-- Views for Common Queries
-- ============================================================================

-- User progress overview
CREATE VIEW user_progress_overview AS
SELECT 
    u.id as user_id,
    u.email,
    u.first_name,
    u.last_name,
    COUNT(DISTINCT ue.course_id) as enrolled_courses,
    COUNT(DISTINCT CASE WHEN ue.completed_at IS NOT NULL THEN ue.course_id END) as completed_courses,
    AVG(ue.progress_percentage) as avg_progress,
    MAX(ue.updated_at) as last_activity
FROM users u
LEFT JOIN user_enrollments ue ON u.id = ue.user_id
WHERE u.is_active = true
GROUP BY u.id, u.email, u.first_name, u.last_name;

-- Course completion statistics
CREATE VIEW course_completion_stats AS
SELECT 
    c.id as course_id,
    c.title,
    c.level_id,
    COUNT(DISTINCT ue.user_id) as total_enrollments,
    COUNT(DISTINCT CASE WHEN ue.completed_at IS NOT NULL THEN ue.user_id END) as completions,
    ROUND(
        COUNT(DISTINCT CASE WHEN ue.completed_at IS NOT NULL THEN ue.user_id END) * 100.0 / 
        NULLIF(COUNT(DISTINCT ue.user_id), 0), 
        2
    ) as completion_rate,
    AVG(ue.progress_percentage) as avg_progress
FROM courses c
LEFT JOIN user_enrollments ue ON c.id = ue.course_id
WHERE c.is_published = true
GROUP BY c.id, c.title, c.level_id;