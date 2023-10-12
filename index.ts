import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const region = aws.config.region;
const azs = pulumi.all([region, aws.getAvailabilityZones()]).apply(([region, azs]) => azs.names);

// Create a VPC
const vpc = new aws.ec2.Vpc("myVpc", { 
    cidrBlock: "10.0.0.0/16",
    tags: {
        Name: "My VPC"
    }
});

// Create an Internet Gateway and attach it to the VPC
const ig = new aws.ec2.InternetGateway("myIg", { vpcId: vpc.id });

// Create a public Route Table
const publicRT = new aws.ec2.RouteTable("publicRT", { vpcId: vpc.id });

// Create a public Route
new aws.ec2.Route("publicRoute", { 
    routeTableId: publicRT.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: ig.id
});

// Create a private Route Table
const privateRT = new aws.ec2.RouteTable("privateRT", { vpcId: vpc.id });

// Create 3 public and 3 private subnets, each in a different AZ
for (let i = 0; i < 3; i++) {
    new aws.ec2.Subnet(`publicSubnet${i}`, { 
        vpcId: vpc.id, 
        cidrBlock: `10.0.${i}.0/24`,
        mapPublicIpOnLaunch: true, 
        availabilityZone: azs[i],
        tags: {
            Name: `publicSubnet${i}`
        }
    }, { parent: publicRT });

    new aws.ec2.Subnet(`privateSubnet${i}`, { 
        vpcId: vpc.id, 
        cidrBlock: `10.0.${i+3}.0/24`, 
        availabilityZone: azs[i+3],
        tags: {
            Name: `privateSubnet${i}`
        }
    }, { parent: privateRT });
}

exports = {
    vpcId: vpc.id,
    publicRTId: publicRT.id,
    privateRTId: privateRT.id
};
