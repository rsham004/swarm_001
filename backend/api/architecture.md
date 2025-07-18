# REST API Architecture - Swarm Coordination Mastery Platform

## Overview
This document outlines the REST API architecture for the Swarm Coordination Mastery learning platform, supporting a gated content delivery system with three learning levels.

## Core Requirements
- **Gated Content System**: Progressive content unlock based on completion
- **Multi-Level Learning**: Beginner (4h), Intermediate (8h), Advanced (12h)
- **Enterprise Ready**: Scalable architecture for business deployment
- **Content Focus**: ruv-swarm, neural patterns, SPARC methodology

## API Design Principles

### 1. RESTful Architecture
- **Resource-Based URLs**: `/api/v1/courses`, `/api/v1/users`, `/api/v1/progress`
- **HTTP Methods**: GET, POST, PUT, DELETE for appropriate operations
- **Status Codes**: Consistent HTTP status code usage
- **Content Type**: JSON as primary format

### 2. Authentication & Authorization
- **JWT-Based Authentication**: Stateless token-based system
- **Role-Based Access Control (RBAC)**:
  - `student`: Basic access to assigned content
  - `instructor`: Content creation and student management
  - `admin`: Full system access
  - `enterprise`: Organization-level management

### 3. Content Management System
- **Hierarchical Content Structure**:
  - Courses → Modules → Lessons → Sections
  - Prerequisites and dependencies
  - Progress tracking at each level

## API Endpoints Structure

### Authentication Endpoints
```
POST /api/v1/auth/login
POST /api/v1/auth/register
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/profile
PUT  /api/v1/auth/profile
```

### User Management
```
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PUT    /api/v1/users/:id
DELETE /api/v1/users/:id
GET    /api/v1/users/:id/progress
PUT    /api/v1/users/:id/progress
```

### Course Management
```
GET    /api/v1/courses
POST   /api/v1/courses
GET    /api/v1/courses/:id
PUT    /api/v1/courses/:id
DELETE /api/v1/courses/:id
GET    /api/v1/courses/:id/modules
POST   /api/v1/courses/:id/modules
GET    /api/v1/courses/:id/enrollment
POST   /api/v1/courses/:id/enroll
```

### Content Delivery
```
GET    /api/v1/content/lessons/:id
GET    /api/v1/content/lessons/:id/next
POST   /api/v1/content/lessons/:id/complete
GET    /api/v1/content/resources/:id
GET    /api/v1/content/assessments/:id
POST   /api/v1/content/assessments/:id/submit
```

### Progress Tracking
```
GET    /api/v1/progress/user/:id
GET    /api/v1/progress/course/:id
POST   /api/v1/progress/track
GET    /api/v1/analytics/completion
GET    /api/v1/analytics/time-spent
```

## Technology Stack

### Backend Framework
- **Node.js with Express.js**: Fast, lightweight, and scalable
- **Alternative**: Fastify for higher performance requirements
- **TypeScript**: Type safety and better developer experience

### Database Layer
- **Primary**: PostgreSQL for relational data
- **Caching**: Redis for session management and performance
- **Search**: Elasticsearch for content search (optional)

### Authentication & Security
- **JWT**: JSON Web Tokens for stateless authentication
- **bcrypt**: Password hashing and security
- **helmet**: Security headers and middleware
- **rate-limiting**: API request throttling

### File Storage
- **AWS S3**: Content files, videos, documents
- **CDN**: CloudFront for global content delivery
- **Local Storage**: Development and testing

## Data Models

### User Model
```javascript
{
  id: UUID,
  email: string,
  password: string (hashed),
  role: enum ['student', 'instructor', 'admin', 'enterprise'],
  profile: {
    firstName: string,
    lastName: string,
    organization: string,
    timezone: string
  },
  subscription: {
    plan: enum ['free', 'pro', 'enterprise'],
    status: enum ['active', 'cancelled', 'expired'],
    expiresAt: timestamp
  },
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Course Model
```javascript
{
  id: UUID,
  title: string,
  description: string,
  level: enum ['beginner', 'intermediate', 'advanced'],
  duration: number, // in minutes
  prerequisites: [UUID],
  modules: [UUID],
  isPublished: boolean,
  createdBy: UUID,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Progress Model
```javascript
{
  id: UUID,
  userId: UUID,
  courseId: UUID,
  moduleId: UUID,
  lessonId: UUID,
  status: enum ['not_started', 'in_progress', 'completed'],
  completedAt: timestamp,
  timeSpent: number, // in seconds
  score: number,
  attempts: number,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

## Content Gating Logic

### Progressive Unlock System
1. **Beginner Level**: Always accessible after registration
2. **Intermediate Level**: Unlocked after 80% completion of Beginner
3. **Advanced Level**: Unlocked after 80% completion of Intermediate
4. **Enterprise Features**: Subscription-based access

### Completion Tracking
- **Lesson Completion**: User must spend minimum time + pass assessment
- **Module Completion**: 100% of lessons completed
- **Course Completion**: 100% of modules completed + final assessment

## Performance Considerations

### Caching Strategy
- **Redis**: Session data, user preferences, frequently accessed content
- **CDN**: Static assets, videos, downloadable resources
- **Database**: Query optimization, proper indexing

### Rate Limiting
- **API Endpoints**: 100 requests per minute per user
- **Authentication**: 5 failed attempts per IP per 15 minutes
- **Content Access**: Progressive loading, pagination

### Database Optimization
- **Indexes**: On frequently queried fields (userId, courseId, etc.)
- **Partitioning**: Progress data by date ranges
- **Connection Pooling**: Efficient database connections

## Error Handling

### Standardized Error Format
```javascript
{
  error: {
    code: string,
    message: string,
    details: object,
    timestamp: timestamp,
    requestId: string
  }
}
```

### Common Error Codes
- `AUTH_REQUIRED`: Authentication needed
- `INSUFFICIENT_PERMISSIONS`: Role-based access denied
- `CONTENT_LOCKED`: Content not unlocked yet
- `SUBSCRIPTION_REQUIRED`: Premium content access
- `RATE_LIMIT_EXCEEDED`: Too many requests

## API Versioning
- **URL Versioning**: `/api/v1/`, `/api/v2/`
- **Header Versioning**: `Accept: application/vnd.api+json;version=1`
- **Backward Compatibility**: Maintain previous versions for 6 months

## Development Workflow
1. **API Design**: OpenAPI specification first
2. **Mock Server**: Early frontend development
3. **Test-Driven Development**: Unit and integration tests
4. **Documentation**: Auto-generated from code annotations
5. **Deployment**: CI/CD pipeline with automated testing

## Security Considerations
- **Input Validation**: All endpoints validate incoming data
- **SQL Injection Prevention**: Parameterized queries
- **XSS Protection**: Content sanitization
- **CSRF Protection**: Token-based validation
- **HTTPS Only**: All communications encrypted

## Monitoring & Analytics
- **Health Checks**: Service availability monitoring
- **Performance Metrics**: Response times, error rates
- **User Analytics**: Learning progress, engagement metrics
- **Business Intelligence**: Course completion rates, user retention

## Scalability Plan
- **Horizontal Scaling**: Load balancers, multiple server instances
- **Database Scaling**: Read replicas, sharding strategies
- **Microservices**: Future migration to service-oriented architecture
- **Queue Systems**: Background job processing with Redis/RabbitMQ

This architecture provides a solid foundation for the Swarm Coordination Mastery platform while maintaining scalability and enterprise readiness.