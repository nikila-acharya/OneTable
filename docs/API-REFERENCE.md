# OneTable API Reference & Deployment Guide

## API Overview

All endpoints return JSON with consistent structure:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

### Authentication

All endpoints require:
- `Authorization: Bearer <JWT_TOKEN>`
- `X-Household-ID: <household-id>`

### Rate Limiting

- 100 requests/minute per household
- 1000 requests/hour per API key
- Health endpoints: unlimited

---

## Endpoints

### Chat & Agents

#### POST /api/agents/chat
Send a message to the Coordinator agent.

**Request:**
```json
{
  "householdId": "hh-001",
  "userId": "u-123",
  "message": "Plan meals for next week"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "I'll plan meals for next week...",
    "cards": [
      {
        "type": "plan_diff",
        "before": { /* meal plan */ },
        "after": { /* proposed plan */ }
      }
    ],
    "approvalCard": {
      "id": "card-xyz",
      "summary": "Plan 7 meals...",
      "expiresAt": "2026-11-06T10:00:00Z"
    }
  }
}
```

### Approvals

#### GET /api/approvals/list
List approval cards for household.

**Query Parameters:**
- `status`: pending | approved | declined (optional)
- `limit`: 10 (default)
- `offset`: 0 (default)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "card-001",
      "summary": "Approve meal plan?",
      "status": "pending",
      "createdAt": "2026-11-05T10:00:00Z",
      "expiresAt": "2026-11-06T10:00:00Z"
    }
  ]
}
```

#### PATCH /api/approvals/{cardId}
Approve or decline an approval card.

**Request:**
```json
{
  "action": "approve",
  "editedProposal": { /* optional edits */ }
}
```

### Actions & Undo

#### GET /api/actions/list
List all action log entries.

**Query Parameters:**
- `level`: P | A (optional)
- `reversible`: true | false (optional)
- `startDate`: ISO date (optional)
- `endDate`: ISO date (optional)

#### POST /api/actions/undo/{actionId}
Undo an A-level action.

**Response:**
```json
{
  "success": true,
  "data": {
    "actionId": "action-001",
    "status": "undone",
    "restoredState": { /* previous state */ }
  }
}
```

### Health & Insights

#### GET /api/health-insights/dashboard
Get health analytics dashboard.

**Query Parameters:**
- `householdId`: required
- `startDate`: ISO date (optional, default: 4 weeks ago)
- `endDate`: ISO date (optional, default: today)

**Response:**
```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": "m-001",
        "name": "Alice",
        "age": 32,
        "activityCompletionRate": 75,
        "mealsThisWeek": 18,
        "avgCaloriesPerMeal": 450
      }
    ],
    "summary": {
      "totalMeals": 64,
      "avgCompletion": 78,
      "allergensAvoided": 12
    }
  }
}
```

### Analytics

#### POST /api/analytics/track
Track an analytics event (internal).

#### GET /api/analytics/dashboard
Get analytics dashboard (admin only).

### Audit & Compliance

#### GET /api/audit/trail
Get audit trail for entity.

**Query Parameters:**
- `entityType`: members | meal_plans | etc.
- `entityId`: id of entity
- `startDate`: ISO date
- `endDate`: ISO date

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "audit-001",
      "timestamp": "2026-11-05T10:00:00Z",
      "action": "update",
      "actor": "u-123",
      "changeSet": {
        "before": { "name": "Alice" },
        "after": { "name": "Alice Smith" }
      }
    }
  ]
}
```

#### GET /api/audit/export
Export audit log as CSV or JSON.

**Query Parameters:**
- `format`: csv | json
- `startDate`: ISO date
- `endDate`: ISO date

---

## Error Handling

All errors follow this format:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_HOUSEHOLD",
    "message": "Household not found",
    "details": {}
  }
}
```

**Common Error Codes:**
- `INVALID_HOUSEHOLD` (400)
- `INVALID_USER` (400)
- `CARD_EXPIRED` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `RATE_LIMIT_EXCEEDED` (429)
- `INTERNAL_ERROR` (500)

---

## Deployment

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Neon Postgres account
- Vercel account
- GitHub repository

### Local Development

```bash
# Clone repo
git clone https://github.com/nikila-acharya/OneTable.git
cd OneTable

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Set up local Postgres
docker-compose up -d postgres

# Run migrations
npm run migrate:dev

# Start dev server
npm run dev

# Open http://localhost:3000
```

### Staging Deployment

```bash
# Push to staging branch
git push origin feature-branch
git pull origin staging
git merge feature-branch
git push origin staging

# GitHub Actions will:
# 1. Run tests
# 2. Build Docker image
# 3. Deploy to Vercel staging
# 4. Run smoke tests
```

### Production Deployment

```bash
# Create release branch
git checkout -b release/1.0.0
git push origin release/1.0.0

# Create PR to main (or merge directly if CI green)
git checkout main
git pull origin release/1.0.0
git push origin main

# GitHub Actions will:
# 1. Run full test suite
# 2. Build production image
# 3. Deploy to Vercel production
# 4. Run database migrations
# 5. Send Slack notification
```

### Environment Variables

**Required:**
```
NEXT_PUBLIC_API_URL=https://onetable.app
DATABASE_URL=postgresql://user:pass@host/onetable
JWT_SECRET=<generate with: openssl rand -base64 32>
```

**Optional:**
```
VERCEL_ORG_ID=<vercel-org-id>
VERCEL_PROJECT_ID=<vercel-project-id>
VERCEL_TOKEN=<vercel-api-token>
DATADOG_API_KEY=<datadog-key>
SENTRY_DSN=<sentry-dsn>
PAGERDUTY_KEY=<pagerduty-integration-key>
SLACK_WEBHOOK=<slack-webhook-url>
```

### Database Migrations

```bash
# Create migration
npm run migrate:create -- --name add_new_column

# Run migrations
npm run migrate:dev      # Local
npm run migrate:staging  # Staging
npm run migrate:prod     # Production

# Rollback (careful!)
npm run migrate:rollback
```

### Monitoring

**Logs:**
```bash
# Vercel
vercel logs <deployment-id>

# Docker (local)
docker logs onetable-app
```

**Metrics:**
- Datadog: https://app.datadoghq.com/
- Sentry: https://sentry.io/
- PagerDuty: https://pagerduty.com/

**Health Checks:**
```bash
# API health
curl https://onetable.app/api/health

# Database
curl https://onetable.app/api/health/database

# Agent system
curl https://onetable.app/api/health/agents
```

### Rollback

If deployment fails:

```bash
# Vercel (automatic rollback to last stable)
vercel rollback

# Or redeploy previous commit
git revert <commit>
git push origin main

# Database (migration rollback)
npm run migrate:rollback
```

---

## Performance Tuning

### Database

```sql
-- Add indexes for common queries
CREATE INDEX idx_households_owner ON households(owner_id);
CREATE INDEX idx_meals_household ON meal_slots(household_id, date);
CREATE INDEX idx_actions_household ON action_logs(household_id, created_at DESC);
```

### Caching

- Next.js ISR (Incremental Static Regeneration)
- Redis for session management
- Browser caching (30s for UI, 24h for static assets)

### API Optimization

- Paginate list endpoints (default 10, max 100)
- Return only requested fields
- Use compression (gzip enabled)

---

## Security Checklist

- [ ] All secrets in `.env` (never committed)
- [ ] HTTPS enforced (automatic on Vercel)
- [ ] CORS configured for frontend origin only
- [ ] Rate limiting enabled
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS protection (CSP headers)
- [ ] CSRF tokens on state-changing requests
- [ ] Audit logging enabled
- [ ] Regular security scans (npm audit, Trivy)
- [ ] Dependency updates (Dependabot)

---

## Support & Escalation

- **Bug reports:** GitHub Issues
- **Questions:** GitHub Discussions
- **Security issues:** security@onetable.app
- **On-call:** PagerDuty

---

**Version:** 1.0.0  
**Last Updated:** 2026-11-05  
**Next Review:** 2026-12-05
