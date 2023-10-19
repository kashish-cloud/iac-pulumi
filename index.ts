import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config("config.dev.yaml");
const vpcCidrBlock = config.require("vpcCidrBlock");
const subnetBaseCidrBlock = config.require("subnetBaseCidrBlock");

// Get data about the current availability zones
const azsData = aws.getAvailabilityZones();

// Create a VPC
const vpc = new aws.ec2.Vpc("myVpc", { 
    cidrBlock: vpcCidrBlock,
    tags: {
        Name: "My VPC"
    }
});

// Create an Internet Gateway and attach it to the VPC
const ig = new aws.ec2.InternetGateway("myIg", { 
    vpcId: vpc.id,
    tags: {
        "Name": "myIg"
    }
});

// Create a public Route Table
const publicRT = new aws.ec2.RouteTable("publicRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "publicRT"
    }
});

// Create a public Route
new aws.ec2.Route("publicRoute", { 
    routeTableId: publicRT.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: ig.id
});

// Create a private Route Table
const privateRT = new aws.ec2.RouteTable("privateRT", { 
    vpcId: vpc.id,
    tags: {
        "Name": "privateRT"
    }
});

azsData.then(azs => {
    // Create a public and private subnet in each availability zone
    azs.names.forEach((zone, index) => {
        if (index < 3) {
            // Create a public subnet
            const publicSubnet = new aws.ec2.Subnet(`publicSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index}.0/24`,
                mapPublicIpOnLaunch: true,
                availabilityZone: zone,
                tags: {
                    "Name": `publicSubnet-${index}`,
                    "Type": "Public"
                }
            });

            // Create set route table association for the public subnet
            new aws.ec2.RouteTableAssociation(`publicRTA-${index}`, {
                routeTableId: publicRT.id,
                subnetId: publicSubnet.id,
            });

            // Create a private subnet
            const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${index}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${index + 100}.0/24`,
                availabilityZone: zone,
                tags: {
                    "Name": `privateSubnet-${index}`,
                    "Type": "Private"
                }
            });
             // Create set route table association for the private subnet
             new aws.ec2.RouteTableAssociation(`privateRTA-${index}`, {
                routeTableId: privateRT.id,
                subnetId: privateSubnet.id,
            });
        }
    });
});

// Export relevant IDs
export const vpcId = vpc.id;
export const publicRTId = publicRT.id;
export const privateRTId = privateRT.id;