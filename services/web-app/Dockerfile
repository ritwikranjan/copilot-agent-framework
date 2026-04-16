FROM node:22-alpine AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --ignore-scripts

# Copy source and build
COPY . .

# Pass build-time env vars for NEXT_PUBLIC_ variables
ARG NEXT_PUBLIC_ENTRA_CLIENT_ID=""
ARG NEXT_PUBLIC_ENTRA_TENANT_ID=""
ARG NEXT_PUBLIC_REDIRECT_URI="http://localhost:3001"
ENV NEXT_PUBLIC_ENTRA_CLIENT_ID=$NEXT_PUBLIC_ENTRA_CLIENT_ID
ENV NEXT_PUBLIC_ENTRA_TENANT_ID=$NEXT_PUBLIC_ENTRA_TENANT_ID
ENV NEXT_PUBLIC_REDIRECT_URI=$NEXT_PUBLIC_REDIRECT_URI

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
