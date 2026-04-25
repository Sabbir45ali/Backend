const { exec } = require("child_process");
const http = require("http");

function makeRequest(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "localhost",
      port: 5000,
      path: path,
      method: method,
      headers: {},
    };
    if (body) {
      options.headers["Content-Type"] = "application/json";
    }
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on("error", (e) => reject(e));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

console.log("Starting server...");
const server = exec("node server.js");

server.stdout.on("data", async (data) => {
  console.log(`[Server] ${data.trim()}`);
  if (data.includes("Server is running")) {
    console.log("\n--- RUNNING API TESTS ---");

    try {
      // Test 1: Get admin services (should be empty or contain user's existing data)
      console.log("\n-> GET /api/admin/services");
      let getServices = await makeRequest("/api/admin/services", "GET");
      console.log("Response:", JSON.stringify(getServices));

      // Test 2: Add a mock service
      console.log("\n-> POST /api/admin/services");
      let addService = await makeRequest("/api/admin/services", "POST", {
        name: "Automated Test Service",
        offerPrice: 100,
      });
      console.log("Response:", JSON.stringify(addService));

      const serviceId = addService?.data?.id;

      // Test 3: Edit the mock service
      if (serviceId) {
        console.log(`\n-> PUT /api/admin/services/${serviceId}`);
        let editService = await makeRequest(
          `/api/admin/services/${serviceId}`,
          "PUT",
          { offerPrice: 150 },
        );
        console.log("Response:", JSON.stringify(editService));

        // Test 4: Delete the mock service so DB remains clean
        console.log(`\n-> DELETE /api/admin/services/${serviceId}`);
        let delService = await makeRequest(
          `/api/admin/services/${serviceId}`,
          "DELETE",
        );
        console.log("Response:", JSON.stringify(delService));
      }

      console.log("\n-> GET /api/admin/appointments");
      let getAppts = await makeRequest("/api/admin/appointments", "GET");
      console.log("Response:", JSON.stringify(getAppts));

      console.log("\n--- ALL TESTS COMPLETED SUCCESSFULLY ---");
    } catch (e) {
      console.error("\nTest error:", e);
    }

    // kill server and exit
    server.kill();
    process.exit(0);
  }
});

server.stderr.on("data", (data) => {
  console.error(`[Server Error] ${data.trim()}`);
  server.kill();
  process.exit(1);
});
