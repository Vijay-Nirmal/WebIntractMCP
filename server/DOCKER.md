# Docker Deployment for WebIntract MCP Server

This directory contains Docker and Docker Compose configurations for deploying the WebIntract MCP Server.

## Files Overview

- `Dockerfile` - Multi-stage Docker build for the .NET 9 application
- `docker-compose.yml` - Production deployment with Redis
- `docker-compose.dev.yml` - Development deployment with enhanced logging

## Quick Start

### Production Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f webintract-mcp-server

# Stop services
docker-compose down
```

### Development Deployment

```bash
# Use development configuration
docker-compose -f docker-compose.dev.yml up -d

# View detailed logs
docker-compose -f docker-compose.dev.yml logs -f webintract-mcp-server
```

## Configuration

### Environment Variables

The Docker Compose files include comprehensive environment variable configuration:

#### Production (`docker-compose.yml`)
- Optimized for production use
- Error logging disabled
- Standard timeouts
- CORS configured for specific origins

#### Development (`docker-compose.dev.yml`)
- Detailed error logging enabled
- Extended timeouts for debugging
- Debug logging level
- Additional CORS origins for development

### Key Environment Variables

| Variable | Production | Development | Description |
|----------|------------|-------------|-------------|
| `ASPNETCORE_ENVIRONMENT` | Production | Development | ASP.NET Core environment |
| `McpIntract__Tool__EnableDetailedErrorLogging` | false | true | Enable detailed error logging |
| `McpIntract__Client__TimeoutSeconds` | 30 | 60 | HTTP client timeout |
| `McpIntract__Tool__TimeoutMinutes` | 5 | 10 | Tool execution timeout |
| `Logging__LogLevel__Default` | Information | Debug | Default log level |

## Services

### WebIntract MCP Server
- **Port:** 8080
- **Health Check:** `/health`
- **Container:** `webintract-mcp-server`

### Redis (Optional)
- **Port:** 6379
- **Container:** `webintract-redis`
- **Purpose:** Caching and SignalR backplane

## Building and Publishing

### Build Docker Image

```bash
# Build the image
docker build -t your-dockerhub-username/webintract-mcp-server:latest .

# Tag for versioning
docker tag your-dockerhub-username/webintract-mcp-server:latest your-dockerhub-username/webintract-mcp-server:v1.0.0
```

### Push to Docker Hub

```bash
# Login to Docker Hub
docker login

# Push images
docker push your-dockerhub-username/webintract-mcp-server:latest
docker push your-dockerhub-username/webintract-mcp-server:v1.0.0
```

### Use Published Image

Update the `docker-compose.yml` to use your published image:

```yaml
services:
  webintract-mcp-server:
    image: your-dockerhub-username/webintract-mcp-server:latest
    # Remove the build section when using published image
```

## Health Checks

All services include health checks:

```bash
# Check service health
docker-compose ps

# Manual health check
curl http://localhost:8080/health
```

## Networking

### Docker Network
- **Network Name:** `webintract-network` (production) / `webintract-dev-network` (development)
- **Driver:** bridge

### Host Access
- Uses `host.docker.internal` to access services running on the host machine
- Allows the containerized server to communicate with Angular app running on host

## Volumes

### Redis Data
- **Volume:** `redis-data` (production) / `redis-dev-data` (development)
- **Purpose:** Persistent Redis storage

### Application Logs
- **Mount:** `./logs:/app/logs`
- **Purpose:** Access application logs from host

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 8080, 6379, and 4200 are available
2. **Client connection**: Verify CORS configuration matches your client origin
3. **Health check failures**: Check application logs for startup errors

### Diagnostic Commands

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs webintract-mcp-server

# Execute commands in container
docker-compose exec webintract-mcp-server /bin/bash

# Check Redis connection
docker-compose exec redis redis-cli ping

# Test endpoints
curl http://localhost:8080/health
curl http://localhost:8080/mcp
```

### Log Analysis

```bash
# Follow logs in real-time
docker-compose logs -f

# Check specific service logs
docker-compose logs webintract-mcp-server
docker-compose logs redis

# Check last 100 lines
docker-compose logs --tail=100 webintract-mcp-server
```

## Customization

### Custom Configuration

Create a `.env` file for environment-specific variables:

```bash
# .env file
DOCKER_TAG=v1.0.0
CLIENT_BASE_URL=https://your-client.com
CORS_ALLOWED_ORIGIN=https://your-client.com
REDIS_CONNECTION_STRING=redis:6379
```

Update docker-compose.yml to use environment variables:

```yaml
services:
  webintract-mcp-server:
    image: your-dockerhub-username/webintract-mcp-server:${DOCKER_TAG:-latest}
    environment:
      - McpIntract__Client__BaseUrl=${CLIENT_BASE_URL}
      - McpIntract__Cors__AllowedOrigins__0=${CORS_ALLOWED_ORIGIN}
```

### Override Configuration

Create a `docker-compose.override.yml` for local overrides:

```yaml
# docker-compose.override.yml
version: '3.8'
services:
  webintract-mcp-server:
    ports:
      - "8081:8080"  # Use different port
    environment:
      - McpIntract__Tool__EnableDetailedErrorLogging=true
```

## Production Considerations

1. **Security**: Use secrets for sensitive configuration
2. **Monitoring**: Add monitoring and alerting
3. **Backup**: Implement Redis backup strategy
4. **Scaling**: Consider using Docker Swarm or Kubernetes for scaling
5. **SSL/TLS**: Configure reverse proxy with SSL termination
6. **Resource Limits**: Set appropriate CPU and memory limits

### Production Docker Compose Example

```yaml
version: '3.8'
services:
  webintract-mcp-server:
    image: your-dockerhub-username/webintract-mcp-server:v1.0.0
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 256M
          cpus: '0.25'
    environment:
      - ASPNETCORE_ENVIRONMENT=Production
      # ... other production settings
```
