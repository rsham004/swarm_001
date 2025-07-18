/**
 * Authentication Integration Tests - Swarm Coordination Mastery Platform
 * Tests for JWT authentication, authorization, and content gating
 */

const request = require('supertest');
const { expect } = require('chai');
const app = require('../../app');
const { db } = require('../../config/database');
const { redis } = require('../../config/redis');

describe('Authentication Integration Tests', () => {
  let server;
  let testUser;
  let adminUser;
  let accessToken;
  let refreshToken;

  before(async () => {
    // Initialize test database
    await db.initialize();
    
    // Create test server
    server = app.listen(0);
    
    // Create test users
    testUser = await createTestUser('student');
    adminUser = await createTestUser('admin');
  });

  after(async () => {
    // Cleanup
    await cleanupTestData();
    await server.close();
    await db.close();
    await redis.quit();
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'newuser@test.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        organization: 'Test Org'
      };

      const response = await request(server)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).to.have.property('message');
      expect(response.body).to.have.property('userId');
      expect(response.body.userId).to.be.a('string');
    });

    it('should fail with invalid email format', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'SecurePass123!',
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(server)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.error.code).to.equal('INVALID_EMAIL');
    });

    it('should fail with weak password', async () => {
      const userData = {
        email: 'test@example.com',
        password: '123',
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(server)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.error.code).to.equal('WEAK_PASSWORD');
    });

    it('should fail with duplicate email', async () => {
      const userData = {
        email: testUser.email,
        password: 'SecurePass123!',
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(server)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.error.code).to.equal('EMAIL_EXISTS');
    });
  });

  describe('POST /auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const loginData = {
        email: testUser.email,
        password: 'password123'
      };

      const response = await request(server)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).to.have.property('accessToken');
      expect(response.body).to.have.property('refreshToken');
      expect(response.body).to.have.property('user');
      expect(response.body.user.email).to.equal(testUser.email);

      // Store tokens for subsequent tests
      accessToken = response.body.accessToken;
      refreshToken = response.body.refreshToken;
    });

    it('should fail with invalid email', async () => {
      const loginData = {
        email: 'nonexistent@test.com',
        password: 'password123'
      };

      const response = await request(server)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.error.code).to.equal('INVALID_CREDENTIALS');
    });

    it('should fail with invalid password', async () => {
      const loginData = {
        email: testUser.email,
        password: 'wrongpassword'
      };

      const response = await request(server)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.error.code).to.equal('INVALID_CREDENTIALS');
    });

    it('should implement rate limiting for failed attempts', async () => {
      const loginData = {
        email: testUser.email,
        password: 'wrongpassword'
      };

      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(server)
          .post('/api/v1/auth/login')
          .send(loginData)
          .expect(401);
      }

      // 6th attempt should be rate limited
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(429);

      expect(response.body.error.code).to.equal('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const response = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).to.have.property('accessToken');
      expect(response.body.accessToken).to.be.a('string');
      expect(response.body.accessToken).to.not.equal(accessToken);
    });

    it('should fail with invalid refresh token', async () => {
      const response = await request(server)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);

      expect(response.body.error.code).to.equal('TOKEN_INVALID');
    });
  });

  describe('Authentication Middleware', () => {
    it('should allow access to protected route with valid token', async () => {
      const response = await request(server)
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).to.have.property('user');
      expect(response.body.user.email).to.equal(testUser.email);
    });

    it('should deny access to protected route without token', async () => {
      const response = await request(server)
        .get('/api/v1/auth/profile')
        .expect(401);

      expect(response.body.error.code).to.equal('TOKEN_MISSING');
    });

    it('should deny access with invalid token', async () => {
      const response = await request(server)
        .get('/api/v1/auth/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error.code).to.equal('TOKEN_INVALID');
    });

    it('should deny access with expired token', async () => {
      // Create an expired token
      const expiredToken = jwt.sign(
        { sub: testUser.id },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );

      const response = await request(server)
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.error.code).to.equal('TOKEN_EXPIRED');
    });
  });

  describe('Role-Based Access Control', () => {
    let studentToken;
    let adminToken;

    before(async () => {
      // Login as student
      const studentResponse = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'password123' });
      studentToken = studentResponse.body.accessToken;

      // Login as admin
      const adminResponse = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, password: 'password123' });
      adminToken = adminResponse.body.accessToken;
    });

    it('should allow admin access to admin-only routes', async () => {
      const response = await request(server)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).to.have.property('users');
    });

    it('should deny student access to admin-only routes', async () => {
      const response = await request(server)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.error.code).to.equal('ROLE_INSUFFICIENT');
    });

    it('should allow student access to student routes', async () => {
      const response = await request(server)
        .get('/api/v1/courses')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body).to.have.property('courses');
    });
  });

  describe('Content Gating', () => {
    let courseId;
    let studentToken;

    before(async () => {
      // Create test course
      courseId = await createTestCourse('beginner');

      // Login as student
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'password123' });
      studentToken = response.body.accessToken;
    });

    it('should allow access to beginner content', async () => {
      const response = await request(server)
        .get(`/api/v1/content/access/${courseId}?contentType=course`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.hasAccess).to.be.true;
      expect(response.body.code).to.equal('ACCESS_GRANTED');
    });

    it('should deny access to intermediate content without prerequisites', async () => {
      const intermediateCourseId = await createTestCourse('intermediate');

      const response = await request(server)
        .get(`/api/v1/content/access/${intermediateCourseId}?contentType=course`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.hasAccess).to.be.false;
      expect(response.body.code).to.equal('PREREQUISITE_LEVEL_NOT_COMPLETED');
    });

    it('should deny access to premium content without subscription', async () => {
      const premiumCourseId = await createTestCourse('beginner', false, true);

      const response = await request(server)
        .get(`/api/v1/content/access/${premiumCourseId}?contentType=course`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.hasAccess).to.be.false;
      expect(response.body.code).to.equal('SUBSCRIPTION_REQUIRED');
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout successfully and blacklist tokens', async () => {
      const response = await request(server)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.message).to.equal('Logout successful');

      // Verify token is blacklisted
      const profileResponse = await request(server)
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      expect(profileResponse.body.error.code).to.equal('TOKEN_BLACKLISTED');
    });
  });

  // Helper functions
  async function createTestUser(role = 'student') {
    const userData = {
      email: `${role}@test.com`,
      password_hash: await bcrypt.hash('password123', 12),
      role,
      first_name: 'Test',
      last_name: 'User',
      is_active: true,
      is_verified: true
    };

    const query = `
      INSERT INTO users (email, password_hash, role, first_name, last_name, is_active, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await db.query(query, [
      userData.email,
      userData.password_hash,
      userData.role,
      userData.first_name,
      userData.last_name,
      userData.is_active,
      userData.is_verified
    ]);

    return result.rows[0];
  }

  async function createTestCourse(level = 'beginner', isFree = true, requiresSubscription = false) {
    const courseData = {
      title: `Test ${level} Course`,
      description: `Test course for ${level} level`,
      level,
      duration_minutes: 60,
      is_published: true,
      is_free: isFree,
      requires_subscription: requiresSubscription,
      created_by: adminUser.id,
      slug: `test-${level}-course-${Date.now()}`
    };

    const query = `
      INSERT INTO courses (title, description, level, duration_minutes, is_published, is_free, requires_subscription, created_by, slug)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;

    const result = await db.query(query, [
      courseData.title,
      courseData.description,
      courseData.level,
      courseData.duration_minutes,
      courseData.is_published,
      courseData.is_free,
      courseData.requires_subscription,
      courseData.created_by,
      courseData.slug
    ]);

    return result.rows[0].id;
  }

  async function cleanupTestData() {
    // Delete test users and their related data
    await db.query('DELETE FROM users WHERE email LIKE $1', ['%@test.com']);
    
    // Delete test courses
    await db.query('DELETE FROM courses WHERE slug LIKE $1', ['test-%']);
    
    // Clear Redis cache
    await redis.flushall();
  }
});

module.exports = {
  createTestUser,
  createTestCourse,
  cleanupTestData
};