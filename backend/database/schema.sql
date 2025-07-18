-- Database Schema for Swarm Coordination Mastery Platform
-- PostgreSQL 14+ compatible

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable timestamp functions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create custom types
CREATE TYPE user_role AS ENUM ('student', 'instructor', 'admin', 'enterprise');
CREATE TYPE subscription_plan AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('active', 'cancelled', 'expired', 'trial');
CREATE TYPE content_level AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE progress_status AS ENUM ('not_started', 'in_progress', 'completed');
CREATE TYPE assessment_type AS ENUM ('quiz', 'assignment', 'project', 'exam');

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'student',
    
    -- Profile information
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    organization VARCHAR(255),
    timezone VARCHAR(50) DEFAULT 'UTC',
    avatar_url VARCHAR(500),
    bio TEXT,
    
    -- Account status
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    
    -- Indexes
    CONSTRAINT users_email_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Subscriptions table
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan subscription_plan NOT NULL DEFAULT 'free',
    status subscription_status NOT NULL DEFAULT 'active',
    
    -- Billing information
    stripe_subscription_id VARCHAR(255),
    stripe_customer_id VARCHAR(255),
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    
    -- Trial information
    trial_start TIMESTAMP,
    trial_end TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(user_id, plan)
);

-- Organizations table (for enterprise users)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    settings JSONB DEFAULT '{}',
    
    -- Billing
    billing_email VARCHAR(255),
    max_users INTEGER DEFAULT 100,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Organization members table
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(organization_id, user_id)
);

-- Courses table
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    level content_level NOT NULL,
    duration_minutes INTEGER NOT NULL, -- Total course duration
    
    -- Content organization
    prerequisites UUID[] DEFAULT '{}', -- Array of course IDs
    learning_objectives TEXT[],
    tags VARCHAR(50)[],
    
    -- Publishing
    is_published BOOLEAN DEFAULT false,
    is_featured BOOLEAN DEFAULT false,
    published_at TIMESTAMP,
    
    -- Pricing
    is_free BOOLEAN DEFAULT false,
    requires_subscription BOOLEAN DEFAULT true,
    price_usd DECIMAL(10,2),
    
    -- Metadata
    created_by UUID NOT NULL REFERENCES users(id),
    thumbnail_url VARCHAR(500),
    trailer_url VARCHAR(500),
    
    -- SEO
    slug VARCHAR(255) UNIQUE,
    meta_description TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Modules table (course subdivisions)
CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL,
    
    -- Content
    learning_objectives TEXT[],
    
    -- Gating
    prerequisites UUID[] DEFAULT '{}', -- Array of module IDs
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(course_id, order_index)
);

-- Lessons table
CREATE TABLE lessons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content TEXT, -- Markdown content
    order_index INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL,
    
    -- Media
    video_url VARCHAR(500),
    video_duration INTEGER, -- in seconds
    transcript TEXT,
    
    -- Resources
    downloadable_resources JSONB DEFAULT '[]',
    external_links JSONB DEFAULT '[]',
    
    -- Completion requirements
    min_time_seconds INTEGER DEFAULT 0,
    requires_assessment BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(module_id, order_index)
);

-- Assessments table
CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type assessment_type NOT NULL,
    
    -- Configuration
    questions JSONB NOT NULL, -- Array of question objects
    passing_score INTEGER DEFAULT 70, -- Percentage
    max_attempts INTEGER DEFAULT 3,
    time_limit_minutes INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure assessment is linked to exactly one content level
    CONSTRAINT assessment_single_parent CHECK (
        (lesson_id IS NOT NULL AND module_id IS NULL AND course_id IS NULL) OR
        (lesson_id IS NULL AND module_id IS NOT NULL AND course_id IS NULL) OR
        (lesson_id IS NULL AND module_id IS NULL AND course_id IS NOT NULL)
    )
);

-- User progress tracking
CREATE TABLE user_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
    
    -- Progress tracking
    status progress_status NOT NULL DEFAULT 'not_started',
    completion_percentage DECIMAL(5,2) DEFAULT 0.00,
    
    -- Time tracking
    time_spent_seconds INTEGER DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Scoring
    score DECIMAL(5,2), -- Percentage score
    attempts INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraints
    UNIQUE(user_id, course_id, module_id, lesson_id)
);

-- Assessment submissions
CREATE TABLE assessment_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Submission data
    answers JSONB NOT NULL, -- User's answers
    score DECIMAL(5,2), -- Percentage score
    passed BOOLEAN DEFAULT false,
    
    -- Timing
    started_at TIMESTAMP NOT NULL,
    submitted_at TIMESTAMP NOT NULL,
    time_taken_seconds INTEGER,
    
    -- Grading
    graded_at TIMESTAMP,
    graded_by UUID REFERENCES users(id),
    feedback TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User enrollments
CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    
    -- Enrollment details
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    starts_at TIMESTAMP,
    expires_at TIMESTAMP,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    completion_percentage DECIMAL(5,2) DEFAULT 0.00,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(user_id, course_id)
);

-- User sessions (for JWT refresh token management)
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token VARCHAR(500) NOT NULL,
    device_info JSONB,
    
    -- IP and location
    ip_address INET,
    user_agent TEXT,
    
    -- Session management
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    
    -- Details
    old_values JSONB,
    new_values JSONB,
    metadata JSONB,
    
    -- Request info
    ip_address INET,
    user_agent TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analytics tables for reporting
CREATE TABLE daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    value DECIMAL(15,2) NOT NULL,
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(date, metric_type)
);

-- Notification settings
CREATE TABLE notification_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Email notifications
    email_course_updates BOOLEAN DEFAULT true,
    email_progress_reminders BOOLEAN DEFAULT true,
    email_marketing BOOLEAN DEFAULT false,
    
    -- Push notifications
    push_course_updates BOOLEAN DEFAULT true,
    push_progress_reminders BOOLEAN DEFAULT true,
    
    -- In-app notifications
    inapp_course_updates BOOLEAN DEFAULT true,
    inapp_progress_reminders BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    UNIQUE(user_id)
);

-- Indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_at ON users(created_at);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

CREATE INDEX idx_courses_level ON courses(level);
CREATE INDEX idx_courses_published ON courses(is_published);
CREATE INDEX idx_courses_created_by ON courses(created_by);
CREATE INDEX idx_courses_slug ON courses(slug);

CREATE INDEX idx_modules_course_id ON modules(course_id);
CREATE INDEX idx_modules_order ON modules(course_id, order_index);

CREATE INDEX idx_lessons_module_id ON lessons(module_id);
CREATE INDEX idx_lessons_order ON lessons(module_id, order_index);

CREATE INDEX idx_assessments_lesson_id ON assessments(lesson_id);
CREATE INDEX idx_assessments_module_id ON assessments(module_id);
CREATE INDEX idx_assessments_course_id ON assessments(course_id);

CREATE INDEX idx_user_progress_user_id ON user_progress(user_id);
CREATE INDEX idx_user_progress_course_id ON user_progress(course_id);
CREATE INDEX idx_user_progress_status ON user_progress(status);
CREATE INDEX idx_user_progress_completed_at ON user_progress(completed_at);

CREATE INDEX idx_assessment_submissions_assessment_id ON assessment_submissions(assessment_id);
CREATE INDEX idx_assessment_submissions_user_id ON assessment_submissions(user_id);

CREATE INDEX idx_enrollments_user_id ON enrollments(user_id);
CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX idx_enrollments_active ON enrollments(is_active);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_refresh_token ON user_sessions(refresh_token);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

CREATE INDEX idx_daily_metrics_date ON daily_metrics(date);
CREATE INDEX idx_daily_metrics_type ON daily_metrics(metric_type);

-- Full-text search indexes
CREATE INDEX idx_courses_fulltext ON courses USING gin(to_tsvector('english', title || ' ' || description));
CREATE INDEX idx_lessons_fulltext ON lessons USING gin(to_tsvector('english', title || ' ' || description || ' ' || content));

-- Trigger functions for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at columns
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_modules_updated_at BEFORE UPDATE ON modules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lessons_updated_at BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_assessments_updated_at BEFORE UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_progress_updated_at BEFORE UPDATE ON user_progress FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_assessment_submissions_updated_at BEFORE UPDATE ON assessment_submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_enrollments_updated_at BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notification_settings_updated_at BEFORE UPDATE ON notification_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate course completion percentage
CREATE OR REPLACE FUNCTION calculate_course_completion(p_user_id UUID, p_course_id UUID)
RETURNS DECIMAL(5,2) AS $$
DECLARE
    total_lessons INTEGER;
    completed_lessons INTEGER;
    completion_percentage DECIMAL(5,2);
BEGIN
    -- Count total lessons in the course
    SELECT COUNT(*) INTO total_lessons
    FROM lessons l
    JOIN modules m ON l.module_id = m.id
    WHERE m.course_id = p_course_id;
    
    -- Count completed lessons
    SELECT COUNT(*) INTO completed_lessons
    FROM user_progress up
    JOIN lessons l ON up.lesson_id = l.id
    JOIN modules m ON l.module_id = m.id
    WHERE up.user_id = p_user_id
      AND m.course_id = p_course_id
      AND up.status = 'completed';
    
    -- Calculate percentage
    IF total_lessons > 0 THEN
        completion_percentage = (completed_lessons::DECIMAL / total_lessons::DECIMAL) * 100;
    ELSE
        completion_percentage = 0;
    END IF;
    
    RETURN completion_percentage;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user can access content based on prerequisites
CREATE OR REPLACE FUNCTION check_content_access(p_user_id UUID, p_course_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    course_level content_level;
    beginner_completion DECIMAL(5,2);
    intermediate_completion DECIMAL(5,2);
BEGIN
    -- Get course level
    SELECT level INTO course_level
    FROM courses
    WHERE id = p_course_id;
    
    -- Beginner level is always accessible
    IF course_level = 'beginner' THEN
        RETURN TRUE;
    END IF;
    
    -- Check intermediate level access
    IF course_level = 'intermediate' THEN
        -- Get beginner completion rate
        SELECT AVG(calculate_course_completion(p_user_id, c.id)) INTO beginner_completion
        FROM courses c
        WHERE c.level = 'beginner'
          AND c.is_published = true;
        
        RETURN COALESCE(beginner_completion, 0) >= 80;
    END IF;
    
    -- Check advanced level access
    IF course_level = 'advanced' THEN
        -- Get intermediate completion rate
        SELECT AVG(calculate_course_completion(p_user_id, c.id)) INTO intermediate_completion
        FROM courses c
        WHERE c.level = 'intermediate'
          AND c.is_published = true;
        
        RETURN COALESCE(intermediate_completion, 0) >= 80;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Insert default data
INSERT INTO users (email, password_hash, role, first_name, last_name, is_verified) VALUES
('admin@swarmlearning.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/lewEzNWGkQBwMu9z2', 'admin', 'System', 'Administrator', true);

-- Insert sample course data
INSERT INTO courses (title, description, level, duration_minutes, created_by, is_published, slug) VALUES
('Swarm Coordination Fundamentals', 'Learn the basics of swarm coordination and multi-agent systems', 'beginner', 240, (SELECT id FROM users WHERE email = 'admin@swarmlearning.com'), true, 'swarm-coordination-fundamentals'),
('Advanced Neural Patterns', 'Master advanced neural patterns and cognitive architectures', 'intermediate', 480, (SELECT id FROM users WHERE email = 'admin@swarmlearning.com'), true, 'advanced-neural-patterns'),
('Enterprise SPARC Methodology', 'Implement SPARC methodology for enterprise applications', 'advanced', 720, (SELECT id FROM users WHERE email = 'admin@swarmlearning.com'), true, 'enterprise-sparc-methodology');

-- Comments for documentation
COMMENT ON TABLE users IS 'User accounts and profile information';
COMMENT ON TABLE subscriptions IS 'User subscription plans and billing information';
COMMENT ON TABLE courses IS 'Course content and metadata';
COMMENT ON TABLE user_progress IS 'User progress tracking for courses, modules, and lessons';
COMMENT ON TABLE assessments IS 'Quizzes, assignments, and other assessments';
COMMENT ON TABLE audit_logs IS 'System audit trail for security and compliance';
COMMENT ON FUNCTION calculate_course_completion(UUID, UUID) IS 'Calculate user completion percentage for a specific course';
COMMENT ON FUNCTION check_content_access(UUID, UUID) IS 'Check if user has access to content based on prerequisites and level completion';