import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "BGV Platform API",
      version: "1.0.0",
      description: "Background Verification Platform — Implemented APIs Only",
    },
    servers: [
      {
        url: "http://localhost:5000",
        description: "Local Development Server",
      },
    ],
    tags: [
      { name: "Client Admin - Candidate", description: "Client Admin - Candidate Management" },
      { name: "HR - Candidate",           description: "HR - Candidate Management" },
    ],
  },
  apis: [
    "./src/routes/clientadminroute/candidateRoutes.js",
    "./src/routes/hrroute/candidateRoutes.js",
  ],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
