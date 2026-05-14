import { ethers } from "hardhat";

async function main() {
  console.log("Deploying InferenceBilling to 0G Network...\n");

  // Get the signer from the private key
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "0G\n");

  const protocolTreasury = deployer.address;

  const InferenceBilling = await ethers.getContractFactory("InferenceBilling", deployer);
  const contract = await InferenceBilling.deploy(protocolTreasury);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  
  console.log("Deployed to:", address);
  console.log("");

  // Register test model
  console.log("Registering model: llama-3-70b...");
  const tx = await contract.registerModel(
    "llama-3-70b",
    deployer.address,
    deployer.address,
    ethers.parseEther("1"),
    8000,
    1500,
    500
  );
  await tx.wait();
  console.log("Model registered!\n");

  console.log("========================================");
  console.log("DEPLOYMENT COMPLETE");
  console.log("Contract:", address);
  console.log("========================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});